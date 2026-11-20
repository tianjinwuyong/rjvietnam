// AQL 抽样对照表（前端本地副本，与后端一致）
// 基于 GB/T 2828.1-2012，检验水平 S-1/S-2/S-3/S-4/G-Ⅰ/G-Ⅱ/G-Ⅲ
// 正常检验一次抽样方案，AQL 可选 0.10~2.5
// 区间表: [lotSizeMin, lotSizeMax, sampleSize, ac, re]

type SamplingRow = [number, number, number, number, number];

// 样本量字码 -> 样本量
const CODE_SAMPLE: Record<string, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50,
  J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

// 字码排序（用于箭头查找）
const CODE_ORDER = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R'];

// 各 AQL 对应的原始表（字码 -> [ac,re] 或 '↓'）
// 从 GB/T 2828.1 表2-A 正常检验一次抽样方案提取
const AQL_TABLES: Record<string, Record<string, [number, number] | '↓'>> = {
  '0.10': {
    A:'↓',B:'↓',C:'↓',D:'↓',E:'↓',F:'↓',G:'↓',H:'↓',J:[0,1],K:[0,1],L:[1,2],M:[1,2],N:[2,3],P:[3,4],Q:[5,6],R:[7,8],
  },
  '0.15': {
    A:'↓',B:'↓',C:'↓',D:'↓',E:'↓',F:'↓',G:'↓',H:[0,1],J:[0,1],K:[1,2],L:[1,2],M:[2,3],N:[3,4],P:[5,6],Q:[7,8],R:[10,11],
  },
  '0.25': {
    A:'↓',B:'↓',C:'↓',D:'↓',E:'↓',F:'↓',G:[0,1],H:[0,1],J:[1,2],K:[1,2],L:[2,3],M:[3,4],N:[5,6],P:[7,8],Q:[10,11],R:[14,15],
  },
  '0.40': {
    A:'↓',B:'↓',C:'↓',D:'↓',E:'↓',F:[0,1],G:[0,1],H:[1,2],J:[2,3],K:[3,4],L:[5,6],M:[7,8],N:[10,11],P:[14,15],Q:[21,22],R:[21,22],
  },
  '0.65': {
    A:'↓',B:'↓',C:'↓',D:'↓',E:[0,1],F:[0,1],G:[1,2],H:[2,3],J:[3,4],K:[5,6],L:[7,8],M:[10,11],N:[14,15],P:[21,22],Q:[21,22],R:[21,22],
  },
  '1.0': {
    A:'↓',B:'↓',C:'↓',D:[0,1],E:[0,1],F:[1,2],G:[1,2],H:[2,3],J:[3,4],K:[5,6],L:[7,8],M:[10,11],N:[14,15],P:[21,22],Q:[21,22],R:[21,22],
  },
  '1.5': {
    A:'↓',B:'↓',C:[0,1],D:[0,1],E:[1,2],F:[2,3],G:[2,3],H:[3,4],J:[5,6],K:[7,8],L:[10,11],M:[14,15],N:[21,22],P:[21,22],Q:[21,22],R:[21,22],
  },
  '2.5': {
    A:'↓',B:[0,1],C:[0,1],D:[1,2],E:[2,3],F:[3,4],G:[3,4],H:[5,6],J:[7,8],K:[10,11],L:[14,15],M:[21,22],N:[21,22],P:[21,22],Q:[21,22],R:[21,22],
  },
};

/** 箭头规则解析：↓ 取下方第一个有数字的字码的 Ac/Re */
function resolveAcRe(code: string, aql: string): [number, number] {
  const table = AQL_TABLES[aql] || AQL_TABLES['0.40'];
  let current = code;
  let guard = 0;
  while (guard++ < 20) {
    const cell = table[current];
    if (Array.isArray(cell)) return cell;
    if (cell === '↓') {
      const idx = CODE_ORDER.indexOf(current);
      if (idx + 1 < CODE_ORDER.length) {
        current = CODE_ORDER[idx + 1];
        continue;
      }
    }
    break;
  }
  return [0, 1];
}

// 批量范围 -> 各检验水平的样本量字码
// 顺序: S-1, S-2, S-3, S-4, G-Ⅰ, G-Ⅱ, G-Ⅲ
const LOT_CODE_TABLE: Array<[number, number, string[]]> = [
  [2, 8,       ['A', 'A', 'A', 'A', 'A', 'A', 'B']],
  [9, 15,      ['A', 'A', 'A', 'A', 'A', 'B', 'C']],
  [16, 25,     ['A', 'A', 'B', 'B', 'B', 'C', 'D']],
  [26, 50,     ['A', 'B', 'B', 'C', 'C', 'D', 'E']],
  [51, 90,     ['B', 'B', 'C', 'C', 'C', 'E', 'F']],
  [91, 150,    ['B', 'B', 'C', 'D', 'D', 'F', 'G']],
  [151, 280,   ['B', 'C', 'D', 'E', 'E', 'G', 'H']],
  [281, 500,   ['B', 'C', 'D', 'E', 'F', 'H', 'J']],
  [501, 1200,  ['C', 'C', 'E', 'F', 'G', 'J', 'K']],
  [1201, 3200, ['C', 'D', 'E', 'G', 'H', 'K', 'L']],
  [3201, 10000,['C', 'D', 'F', 'G', 'J', 'L', 'M']],
  [10001, 35000, ['C', 'D', 'F', 'H', 'K', 'M', 'N']],
  [35001, 150000, ['D', 'E', 'G', 'H', 'L', 'N', 'P']],
  [150001, 500000, ['D', 'E', 'G', 'J', 'M', 'P', 'Q']],
  [500001, Number.MAX_SAFE_INTEGER, ['D', 'E', 'H', 'J', 'N', 'Q', 'R']],
];

const SCHEME_INDEX: Record<string, number> = {
  'S-1': 0, 'S-2': 1, 'S-3': 2, 'S-4': 3,
  'G-I': 4, 'G-Ⅰ': 4, 'G-II': 5, 'G-Ⅱ': 5, 'G-III': 6, 'G-Ⅲ': 6,
};

export interface SamplingInfo {
  sampleSize: number;
  ac: number;
  re: number;
}

const FALLBACK: SamplingInfo = { sampleSize: 5, ac: 0, re: 1 };

function normalizeScheme(scheme?: string): string {
  return (scheme || '').trim().toUpperCase()
    .replace(/G-Ⅰ/g, 'G-I').replace(/G-Ⅱ/g, 'G-II').replace(/G-Ⅲ/g, 'G-III')
    .replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III');
}

function normalizeAql(aql?: string): string {
  const s = (aql || '0.4').trim();
  const valid = ['0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5'];
  const num = parseFloat(s);
  return valid.find(v => parseFloat(v) === num) || '0.40';
}

/**
 * 根据抽样方案、AQL与来料批量计算抽样数 / Ac / Re。
 * 支持 S-1/S-2/S-3/S-4/G-Ⅰ/G-Ⅱ/G-Ⅲ（含罗马数字和阿拉伯数字写法）。
 * AQL 支持 0.10/0.15/0.25/0.40/0.65/1.0/1.5/2.5。
 * 查不到方案或 lotSize < 2 时兜底 { sampleSize: 5, ac: 0, re: 1 }。
 */
export function getSamplingInfo(scheme: string | undefined, lotSize: number, aql?: string): SamplingInfo {
  if (!lotSize || lotSize < 2) return { ...FALLBACK };
  const normalized = normalizeScheme(scheme);
  const idx = SCHEME_INDEX[normalized];
  if (idx === undefined) return { ...FALLBACK };
  const aqlNorm = normalizeAql(aql);

  for (const [min, max, codes] of LOT_CODE_TABLE) {
    if (lotSize >= min && lotSize <= max) {
      const code = codes[idx];
      const sampleSize = CODE_SAMPLE[code] || 5;
      const [ac, re] = resolveAcRe(code, aqlNorm);
      return { sampleSize, ac, re };
    }
  }
  return { ...FALLBACK };
}

/** 判断 samplingPlanText 是否为内置自动计算方案 */
export function isAutoSamplingScheme(scheme?: string): boolean {
  const normalized = normalizeScheme(scheme);
  return normalized in SCHEME_INDEX;
}

/** 所有支持的抽样方案列表（用于下拉框） */
export const SAMPLING_SCHEME_OPTIONS = [
  { value: 'S-1', label: 'ui.S-1（特殊）' },
  { value: 'S-2', label: 'ui.S-2（特殊）' },
  { value: 'S-3', label: 'ui.S-3（特殊）' },
  { value: 'S-4', label: 'ui.S-4（特殊）' },
  { value: 'G-I', label: 'ui.G-Ⅰ（一般）' },
  { value: 'G-II', label: 'ui.G-Ⅱ（一般）' },
  { value: 'G-III', label: 'ui.G-Ⅲ（一般）' },
];

/** 所有支持的 AQL 列表（用于下拉框） */
export const AQL_OPTIONS = [
  { value: '0.10', label: '0.10' },
  { value: '0.15', label: '0.15' },
  { value: '0.25', label: '0.25' },
  { value: '0.40', label: '0.40' },
  { value: '0.65', label: '0.65' },
  { value: '1.0', label: '1.0' },
  { value: '1.5', label: '1.5' },
  { value: '2.5', label: '2.5' },
];

/** 系统默认 AQL（与模板/后端默认值保持一致） */
export const DEFAULT_AQL = '0.40';

/** AQL 规范化展示写法：0.4 → 0.40，1 → 1.0 */
export function formatAqlDisplay(aql?: string): string {
  const s = (aql || '').trim();
  if (!s) return DEFAULT_AQL;
  const num = parseFloat(s);
  if (Number.isNaN(num)) return s;
  const hit = AQL_OPTIONS.find((o) => parseFloat(o.value) === num);
  return hit ? hit.value : s;
}

/**
 * 抽样方案展示文本。
 * 国标 GB/T 2828.1 方案（S-1~S-4 / G-Ⅰ~G-Ⅲ）必须带上 AQL，
 * 否则方案不完整（Ac/Re 就是由「检验水平 + AQL + 批量」三者共同决定的）。
 * 非国标方案（N=5 固定样本量、全检、自定义文本）原样输出。
 */
export function formatSamplingPlan(planText?: string, aql?: string): string {
  const plan = (planText || '').trim();
  if (!plan) return '-';
  if (isAutoSamplingScheme(plan)) {
    // 模板文本里若已手写 AQL，避免重复拼接
    if (/aql/i.test(plan)) return plan;
    return `${plan} / AQL ${formatAqlDisplay(aql)}`;
  }
  return plan;
}
