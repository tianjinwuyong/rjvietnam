/**
 * 智能规格解析器
 * 支持各种常见的规格输入格式，自动解析出LSL和USL
 */
import { translate as t } from '../i18n';

export interface SpecResult {
  lsl?: number;
  usl?: number;
  /**
   * 边界开闭标记（严格比较）：
   * - lslExclusive=true  表示「大于 lsl」为合格，测量值等于 lsl 判 NG（开边界）
   * - uslExclusive=true  表示「小于 usl」为合格，测量值等于 usl 判 NG（开边界）
   * 缺省为闭边界（等于边界值判 OK），与 ≥/≤ 语义一致。
   */
  lslExclusive?: boolean;
  uslExclusive?: boolean;
  valid: boolean;
  message?: string;
}

/**
 * 解析科学计数法，比如 10^9 → 1000000000
 */
function parseScientificNotation(str: string): string {
  // 匹配 10^9、1.5e6 等格式
  const scientificRegex = /(\d+\.?\d*)\^(\d+)/g;
  return str.replace(scientificRegex, (match, base, exponent) => {
    const result = Math.pow(parseFloat(base), parseInt(exponent));
    return String(result);
  });
}

/**
 * 解析规格字符串，返回LSL和USL
 */
export function parseSpec(spec: string | undefined | null): SpecResult {
  if (!spec || spec.trim() === '') {
    return { valid: false, message: t('ui.规格为空') };
  }

  let str = spec.trim().replace(/\s+/g, '');
  str = parseScientificNotation(str);

  // 0. 逗号小数归一化（欧式写法或输入法手滑）：
  //    「3.15-4,15」必须解析成 3.15~4.15，而不是把上限静默截断成 4（会导致 4.1 被误判超差）。
  //    规则：数字后的逗号后面跟 1~2 位数字（后面不再是数字）时视为小数点；
    //    「1,000」这类千分位（逗号后 3 位数字）不处理。
  str = str.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  //    千分位（逗号后恰好 3 位数字）剥离：「1,000-2,000」→「1000-2000」，
  //    否则范围正则会匹配到「000-2」把上下限解析成 0~2
  str = str.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');

  // 1. 文字描述。注意「不小于/不大于/不低于/不高于」包含「小于/大于」子串，
  //    必须先匹配否定形式，否则会被反向解析。
  //    「不小于5」= ≥5 → lsl=5 闭边界；「不大于5」= ≤5 → usl=5 闭边界
  if (/不小于|不低于/.test(str)) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { lsl: parseFloat(match[1]), valid: true };
    }
  }
  if (/不大于|不高于/.test(str)) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { usl: parseFloat(match[1]), valid: true };
    }
  }
  // 「小于5」「低于5」= <5 → usl=5 开边界（等于 5 不合格）
  if (str.includes('小于') || str.includes('低于')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { usl: parseFloat(match[1]), uslExclusive: true, valid: true };
    }
  }
  // 「大于5」「高于5」= >5 → lsl=5 开边界（等于 5 不合格）
  if (str.includes('大于') || str.includes('高于')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { lsl: parseFloat(match[1]), lslExclusive: true, valid: true };
    }
  }

  // 2. 文字描述范围："XX到XX"、"XX~XX"、"XX-XX"（含全角 ～/，分隔符）
  const rangeMatch = str.match(/(\d+\.?\d*)\s*(?:到|~|～|-|—|–|，)\s*(\d+\.?\d*)/);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    return {
      lsl: Math.min(low, high),
      usl: Math.max(low, high),
      valid: true,
    };
  }

  // 3. 不等号：需区分严格(</>)与非严格(≤/≥)边界
  //    ≤XX、<=XX → usl 闭边界；＜XX、<XX → usl 开边界
  if (str.startsWith('≤') || str.startsWith('<=')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { usl: parseFloat(match[1]), valid: true };
    }
  }
  if (str.startsWith('＜') || str.startsWith('<')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { usl: parseFloat(match[1]), uslExclusive: true, valid: true };
    }
  }
  //    ≥XX、>=XX → lsl 闭边界；＞XX、>XX → lsl 开边界
  if (str.startsWith('≥') || str.startsWith('>=')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { lsl: parseFloat(match[1]), valid: true };
    }
  }
  if (str.startsWith('＞') || str.startsWith('>')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { lsl: parseFloat(match[1]), lslExclusive: true, valid: true };
    }
  }

  // 4. MAX/MIN格式：XXMAX、XXMIN
  if (str.toUpperCase().includes('MAX')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { usl: parseFloat(match[1]), valid: true };
    }
  }
  if (str.toUpperCase().includes('MIN')) {
    const match = str.match(/(\d+\.?\d*)/);
    if (match) {
      return { lsl: parseFloat(match[1]), valid: true };
    }
  }

  // 5. 双向公差：XX±XX（包括百分比）
  const toleranceMatch = str.match(/(\d+\.?\d*)\s*±\s*(\d+\.?\d*)(%)?/);
  if (toleranceMatch) {
    const base = parseFloat(toleranceMatch[1]);
    const tolerance = parseFloat(toleranceMatch[2]);
    const isPercent = toleranceMatch[3] === '%';
    const actualTolerance = isPercent ? (base * tolerance / 100) : tolerance;
    return {
      lsl: base - actualTolerance,
      usl: base + actualTolerance,
      valid: true,
    };
  }

  // 6. 上下偏差格式：XX(+a/+b) 或 XX(-a/-b) 或 XX(+a/-b)
  const deviationMatch = str.match(/(\d+\.?\d*)\s*\(\s*([+-]?\d+\.?\d*)\s*[\/,，]\s*([+-]?\d+\.?\d*)\s*\)/);
  if (deviationMatch) {
    const base = parseFloat(deviationMatch[1]);
    const upperDev = parseFloat(deviationMatch[2]);
    const lowerDev = parseFloat(deviationMatch[3]);
    return {
      lsl: base + lowerDev,
      usl: base + upperDev,
      valid: true,
    };
  }

  // 7. 只有一个数字，可能是单边上限或下限？这里默认不判定
  if (/^\d+\.?\d*$/.test(str)) {
    return { valid: false, message: t('ui.请指定公差或上下限') };
  }

  return { valid: false, message: t('ui.无法识别的规格格式') };
}

/**
 * 判断测量值是否超出规格
 */
export function isOutOfSpec(
  value: string | number | undefined,
  spec: string | undefined | null,
): boolean {
  if (value === '' || value === undefined || value === null) return false;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return false;

  const specResult = parseSpec(spec);
  // Spec解析不出来的时候，不自动判定，返回false由用户手动选择
  if (!specResult.valid) return false;

  if (specResult.lsl !== undefined) {
    if (n < specResult.lsl) return true;
    // 开边界（「大于X」「>X」）：等于下限时同样不合格
    if (specResult.lslExclusive && n === specResult.lsl) return true;
  }
  if (specResult.usl !== undefined) {
    if (n > specResult.usl) return true;
    // 开边界（「小于X」「<X」）：等于上限时同样不合格
    if (specResult.uslExclusive && n === specResult.usl) return true;
  }
  return false;
}

/**
 * 统计测量值中超差个数（空值与非数值忽略，无 Spec 时不自动判定返回 0）
 */
export function countOutOfSpec(
  measuredValues: (string | number | undefined | null)[] | undefined | null,
  spec: string | undefined | null,
): number {
  if (!measuredValues) return 0;
  return measuredValues.filter((v) => {
    if (v === '' || v === undefined || v === null) return false;
    const s = typeof v === 'string' ? v.trim() : String(v);
    if (s === '') return false;
    return isOutOfSpec(s, spec);
  }).length;
}

/**
 * 按不良数与 Ac 判定合格性（GB/T 2828.1：不良数 ≤ Ac 判接收）
 */
export function judgeByAc(defectQty: number, ac?: number | null): boolean {
  if (ac !== undefined && ac !== null && !Number.isNaN(Number(ac))) {
    return defectQty <= Number(ac);
  }
  return defectQty === 0;
}

/**
 * 基于测量值 + Spec + Ac 重算一条检验记录的 defectQty / isPass。
 * 用途：草稿/历史数据恢复时清掉缓存的旧判定值（旧值可能是解析器修复前算错的）。
 * 仅当存在已填写的测量值时才重算不良数；否则保留手动填写的不良数。
 */
export function recomputeRecordJudgment<
  T extends { measuredValues?: string[]; defectQty?: number; isPass?: boolean; ac?: number; spec?: string },
>(rec: T): T {
  let defectQty = Number(rec.defectQty || 0);
  const hasMeasured =
    Array.isArray(rec.measuredValues) && rec.measuredValues.some((v) => v !== undefined && v !== null && String(v).trim() !== '');
  if (hasMeasured) {
    defectQty = countOutOfSpec(rec.measuredValues, rec.spec);
  }
  const isPass = judgeByAc(defectQty, rec.ac);
  return { ...rec, defectQty, isPass };
}
