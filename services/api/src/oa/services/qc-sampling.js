// ============================================================
// qc-sampling —— 抽样方案与抽样数量推定（GB/T 2828.1-2012）
//
// 依据：D:/WMS-20261019/deliverables/IQC-OA-系统功能需求规格-AI可执行-v1.0.md
//       §5（算法 A）+ 附录 A（机器可读抽样表）
//
// 三条纪律（改动前先读 §5.4 / §5.7）：
//   1) 箭头 `↓`/`↑` 不是"取上一行/下一行的 Ac/Re"，而是**沿同 AQL 列**找第一个
//      真正有方案的行，并用**那一行**的样本量（↓ 的情况；见 §5.4 例子）；
//   2) 样本量 ≥ 批量时按 §5.7 转全检：sampleSize=批量，fullInspection=true；
//   3) 兜底不抛错，但必须带 fallback=true 让上层在报告上打 ⚠️（§5.8 硬要求）。
// ============================================================

/* ---------- 一、常量表（附录 A） ---------- */

/** 26 列 AQL，索引 0..25 */
export const AQL_COLUMNS = [
  '0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25', '0.40',
  '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10', '15', '25',
  '40', '65', '100', '150', '250', '400', '650', '1000',
];

/** 字码顺序（无 I、O，避免与 1、0 混淆） */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S'];

/** 表1：批量 → 样本量字码（§5.3 / §A.5） */
const BATCH_TO_CODE = [
  { min: 2, max: 8, L: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'A', 'S-4': 'A', I: 'A', II: 'A', III: 'B' } },
  { min: 9, max: 15, L: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'A', 'S-4': 'A', I: 'A', II: 'B', III: 'C' } },
  { min: 16, max: 25, L: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'B', 'S-4': 'B', I: 'B', II: 'C', III: 'D' } },
  { min: 26, max: 50, L: { 'S-1': 'A', 'S-2': 'B', 'S-3': 'B', 'S-4': 'C', I: 'C', II: 'D', III: 'E' } },
  { min: 51, max: 90, L: { 'S-1': 'B', 'S-2': 'B', 'S-3': 'C', 'S-4': 'C', I: 'C', II: 'E', III: 'F' } },
  { min: 91, max: 150, L: { 'S-1': 'B', 'S-2': 'B', 'S-3': 'C', 'S-4': 'D', I: 'D', II: 'F', III: 'G' } },
  { min: 151, max: 280, L: { 'S-1': 'B', 'S-2': 'C', 'S-3': 'D', 'S-4': 'E', I: 'E', II: 'G', III: 'H' } },
  { min: 281, max: 500, L: { 'S-1': 'B', 'S-2': 'C', 'S-3': 'D', 'S-4': 'E', I: 'F', II: 'H', III: 'J' } },
  { min: 501, max: 1200, L: { 'S-1': 'C', 'S-2': 'C', 'S-3': 'E', 'S-4': 'F', I: 'G', II: 'J', III: 'K' } },
  { min: 1201, max: 3200, L: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'E', 'S-4': 'G', I: 'H', II: 'K', III: 'L' } },
  { min: 3201, max: 10000, L: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'F', 'S-4': 'G', I: 'J', II: 'L', III: 'M' } },
  { min: 10001, max: 35000, L: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'F', 'S-4': 'H', I: 'K', II: 'M', III: 'N' } },
  { min: 35001, max: 150000, L: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'G', 'S-4': 'J', I: 'L', II: 'N', III: 'P' } },
  { min: 150001, max: 500000, L: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'G', 'S-4': 'J', I: 'M', II: 'P', III: 'Q' } },
  { min: 500001, max: null, L: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'H', 'S-4': 'K', I: 'N', II: 'Q', III: 'R' } },
];

/** 样本量表（§5.5） */
const N_NORMAL = { A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50, J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000 };
const N_TIGHTENED = { ...N_NORMAL, S: 3150 };
const N_REDUCED = { A: 2, B: 2, C: 2, D: 3, E: 5, F: 8, G: 13, H: 20, J: 32, K: 50, L: 80, M: 125, N: 200, P: 315, Q: 500, R: 800 };

/** 表2-A 正常（附录 A.1）—— 每行 26 字符，`.`=↓ `^`=↑ 字母=PAIRS 索引 */
const PAIRS_2A = ['0/1', '1/2', '2/3', '3/4', '5/6', '6/7', '7/8', '10/11', '14/15', '21/22', '24/25'];
const ROWS_2A = {
  A: '..........................',
  B: '..........................',
  C: '..............A...........',
  D: '.............AB...........',
  E: '..........ABCD............',
  F: '.........ABCDEF...........',
  G: '..........ABCDE...........',
  H: '.........ABCDEGH..........',
  J: '........ABCDEGHI..........',
  K: '......ABCDEGHIJK..........',
  L: '.....ABCDEGHIJ^^^^^^^^^^^^',
  M: '.....ABCDEGHIJ^^^^^^^^^^^^',
  N: '....ABCDEGHIJ^^^^^^^^^^^^^',
  P: '...ABCDEGHIJ^^^^^^^^^^^^^^',
  Q: '..ABCDEGHIJ^^^^^^^^^^^^^^^',
  R: '.ABCDEGHIJ^^^^^^^^^^^^^^^^',
};

/** 表2-B 加严（附录 A.2） */
const PAIRS_2B = ['0/1', '1/2', '2/3', '3/4', '5/6', '7/8', '9/10', '12/13', '16/17', '21/22', '27/28', '34/35', '43/44', '18/19', '22/23'];
const ROWS_2B = {
  A: '...............A..........',
  B: '..............A...........',
  C: '.............A............',
  D: '............A.............',
  E: '...........A..............',
  F: '..........A...............',
  G: '.........A................',
  H: '........ABCDEFG...........',
  J: '.......ABCDEFGH...........',
  K: '......ABCDEFGHI...........',
  L: '.....ABCDEFGHIJ...........',
  M: '....ABCDEFGHIJK...........',
  N: '...ABCDEFGHIJKL...........',
  P: '..ABCDEFGHIJKLM...........',
  Q: '.ABCDEFGHIJKL.............',
  R: 'ABCDEFGHIJKL..............',
  S: '^^^^^^^^^^^^^^^^^^^^^^^^NO',
};

/** 表2-C 放宽（附录 A.3） */
const PAIRS_2C = ['0/1', '1/2', '2/3', '3/4', '5/6', '6/7', '8/9', '10/11', '12/13'];
const ROWS_2C = {
  A: '...............A..........',
  B: '..............A...........',
  C: '.............A............',
  D: '............AABB..........',
  E: '...........AABBCC.........',
  F: '..........AABBCDEE........',
  G: '.........AABBCDEFG........',
  H: '........AABBCDEFGH........',
  J: '.......AABBCDEFGHI........',
  K: '......AABBCDEFGHI.........',
  L: '.....AABBCDEFGHI..........',
  M: '....AABBCDEFGHI...........',
  N: '...AABBCDEFGHI............',
  P: '..AABBCDEFGHI.............',
  Q: '.AABBCDEFGHI..............',
  R: 'AABBCDEFGHI...............',
};

const TABLES = {
  normal: { rows: ROWS_2A, pairs: PAIRS_2A, sizes: N_NORMAL },
  tightened: { rows: ROWS_2B, pairs: PAIRS_2B, sizes: N_TIGHTENED },
  reduced: { rows: ROWS_2C, pairs: PAIRS_2C, sizes: N_REDUCED },
};

/* ---------- 二、归一化（§5.2） ---------- */

/** 全角转半角 + 罗马数字归一 */
function toHalfWidth(s) {
  return String(s)
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

export function normalizeLevel(input) {
  let s = toHalfWidth(input || '').trim().toUpperCase();
  s = s.replace(/[Ⅰ]/g, 'I').replace(/[Ⅱ]/g, 'II').replace(/[Ⅲ]/g, 'III');
  // 去掉 G- / G 前缀，去掉空格与下划线；保留 S-x（特殊水平）
  const compact = s.replace(/[\s_]/g, '').replace(/^G-?/, '');
  const map = {
    'S-1': 'S-1', S1: 'S-1',
    'S-2': 'S-2', S2: 'S-2',
    'S-3': 'S-3', S3: 'S-3',
    'S-4': 'S-4', S4: 'S-4',
    '1': 'I', I: 'I',
    '2': 'II', II: 'II',
    '3': 'III', III: 'III',
  };
  return map[compact] || 'II'; // 其它任何值 → II，不抛错（§5.2 🔒）
}

/** AQL 归一：0.4 与 0.40 等价；找不到则原样返回 */
export function normalizeAql(input) {
  const raw = String(input ?? '').trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return { aql: raw, index: -1 };
  const idx = AQL_COLUMNS.findIndex((c) => Math.abs(Number.parseFloat(c) - n) < 1e-9);
  return idx >= 0 ? { aql: AQL_COLUMNS[idx], index: idx } : { aql: raw, index: -1 };
}

/** 批量 → 样本量字码 */
export function codeLetterFor(lotSize, level) {
  const n = Math.trunc(Number(lotSize));
  if (!Number.isFinite(n) || n < 2) {
    const err = new Error('批量必须大于等于 2');
    err.code = 'E-SAMP-001';
    throw err;
  }
  const lv = normalizeLevel(level);
  const row = BATCH_TO_CODE.find((r) => n >= r.min && (r.max === null || n <= r.max));
  return (row && row.L[lv]) || 'A';
}

/* ---------- 三、查表取 Ac/Re（§5.4） ---------- */

function decodeCell(ch, pairs) {
  if (ch === '.') return '↓';
  if (ch === '^') return '↑';
  const p = pairs[ch.charCodeAt(0) - 65];
  if (!p) return null;
  const [ac, re] = p.split('/').map(Number);
  return [ac, re];
}

/**
 * 从起始字码出发沿同 AQL 列找方案。
 * ↓ 用命中行的样本量；↑ 保持**起始字码**的样本量（规格 §5.9 向量 9 的口径）。
 */
function resolveAcRe(table, codeLetter, aqlIndex) {
  const { rows, pairs, sizes } = table;
  const startLetter = codeLetter;
  let cur = codeLetter;
  let dir = null;
  let usedFallback = false;

  for (let guard = 0; guard < 20; guard++) {
    const row = rows[cur];
    if (!row) break;
    const cell = decodeCell(row[aqlIndex] || '.', pairs);

    if (Array.isArray(cell)) {
      const sampleSize = dir === 'up'
        ? (sizes[startLetter] || sizes[cur] || 2)
        : (sizes[cur] || 2);
      return { codeLetter: cur, sampleSize, ac: cell[0], re: cell[1], fallback: false };
    }

    const i = LETTERS.indexOf(cur);
    if (cell === '↓') {
      // 同列向下；若上一跳是向上，说明列底已到，转兜底防死循环
      if (dir === 'up') break;
      dir = 'down';
      if (i + 1 < LETTERS.length) { cur = LETTERS[i + 1]; continue; }
      break;
    }
    if (cell === '↑') {
      if (dir === 'down') break;
      dir = 'up';
      if (i - 1 >= 0) { cur = LETTERS[i - 1]; continue; }
      break;
    }
    break; // 空/越界
  }

  usedFallback = true;
  return {
    codeLetter: startLetter,
    sampleSize: (sizes[startLetter] || 2) + 2,
    ac: 0,
    re: 1,
    fallback: usedFallback,
  };
}

/**
 * 在**已确定的样本量字码**上查某 AQL 的 Ac/Re（不改变样本量）。
 * 外观重/轻缺陷共用同一批样本，所以轻缺陷不能自己再算一个 n —— 用这个函数。
 */
export function acReAtLetter(codeLetter, aqlInput, strictness = 'normal') {
  const table = TABLES[strictness] || TABLES.normal;
  const { aql, index } = normalizeAql(aqlInput || '0.40');
  if (index < 0) return { aql, ac: 0, re: 1, fallback: true };
  const rows = table.rows;
  const start = LETTERS.includes(codeLetter) ? codeLetter : 'A';
  let cur = start;
  let dir = null;
  for (let guard = 0; guard < 20; guard++) {
    const row = rows[cur];
    if (!row) break;
    const cell = decodeCell(row[index] || '.', table.pairs);
    if (Array.isArray(cell)) return { aql, ac: cell[0], re: cell[1], fallback: false };
    const i = LETTERS.indexOf(cur);
    if (cell === '↓') { if (dir === 'up') break; dir = 'down'; if (i + 1 < LETTERS.length) { cur = LETTERS[i + 1]; continue; } break; }
    if (cell === '↑') { if (dir === 'down') break; dir = 'up'; if (i - 1 >= 0) { cur = LETTERS[i - 1]; continue; } break; }
    break;
  }
  return { aql, ac: 0, re: 1, fallback: true };
}

/**
 * 外观项：重缺陷（aql）+ 轻缺陷（aql_minor）两类。
 * 样本量取重缺陷方案（抽样强度由它决定），轻缺陷的 Ac/Re 在同一字码下查表。
 * 没有 aql_minor → 退化为普通单项（老行为）。
 */
export function planForAppearance(item = {}, lotSize, materialStrictness = 'normal') {
  const majorAql = item.aql || '0.40';
  const base = planForItem({ ...item, aql: majorAql }, lotSize, materialStrictness);
  const minorAql = item.aql_minor ? String(item.aql_minor).trim() : '';
  if (!minorAql) return { ...base, minor: null };

  const letter = base.codeLetter || null;
  const minor = letter
    ? acReAtLetter(letter, minorAql, base.strictness === 'fixed' ? 'normal' : base.strictness)
    : { aql: minorAql, ac: Number(item.ac) || 0, re: Number(item.re) || 1, fallback: true };

  return {
    ...base,
    minor: { aql: minor.aql, ac: minor.ac, re: minor.re, fallback: !!minor.fallback },
  };
}

/* ---------- 四、主入口（§5.1） ---------- */

/**
 * 计算抽样方案。
 * @param {object} p { lotSize, inspectionLevel, aql, strictness, samplingPlanText, fixedSampleSize, fixedAc, fixedRe, sectionType }
 */
export function calculateSamplingPlan(p = {}) {
  const lotSize = Math.trunc(Number(p.lotSize));
  if (!Number.isFinite(lotSize) || lotSize < 2) {
    const err = new Error('批量必须大于等于 2');
    err.code = 'E-SAMP-001';
    throw err;
  }

  const level = normalizeLevel(p.inspectionLevel || p.samplingPlanText);
  const { aql, index } = normalizeAql(p.aql || '0.40');
  const strictness = ['normal', 'tightened', 'reduced'].includes(p.strictness) ? p.strictness : 'normal';
  const aqlIndex = index >= 0 ? index : 8; // AQL 不在 26 列内 → 0.40 兜底并标 warning（W-SAMP-002）

  const table = TABLES[strictness] || TABLES.normal;
  const startLetter = codeLetterFor(lotSize, level);
  const r = resolveAcRe(table, startLetter, aqlIndex);

  let sampleSize = r.sampleSize;
  let codeLetter = r.codeLetter;
  let fullInspection = false;
  if (sampleSize >= lotSize) {
    // §5.7：样本量 ≥ 批量 → 全检，样本量取批量。
    // 此时字码回到表1 输出的原始字码（箭头链上找到的行已不代表样本量），
    // 与规格 §5.9 向量 21（批量 2 → A/2/0/1）一致。
    sampleSize = lotSize;
    codeLetter = startLetter;
    fullInspection = true;
  }

  return {
    codeLetter,
    sampleSize,
    ac: r.ac,
    re: r.re,
    applied: true,
    strictness,
    inspectionLevel: level,
    aql,
    fullInspection,
    fallback: !!r.fallback || index < 0,
    warning: index < 0 ? 'W-SAMP-002' : (r.fallback ? 'W-SAMP-003' : null),
  };
}

/**
 * 逐项推定（§5.6，分支顺序不可调换）。
 * @param {object} item 模板项目行（sampling_plan_text / aql / sample_size / ac / re / section_type）
 * @param {number} lotSize
 * @param {string} materialStrictness 物料当前严格度（WMS 主责，OA 只消费）
 */
export function planForItem(item = {}, lotSize, materialStrictness = 'normal') {
  const scheme = String(item.sampling_plan_text || '').trim();
  const fallback = {
    sampleSize: Number(item.sample_size) || 0,
    ac: Number(item.ac) || 0,
    re: Number(item.re) || 1,
  };
  const lot = Math.trunc(Number(lotSize)) || 0;

  // §5.7 全检封顶：任何分支（含固定样本量）只要 n ≥ 批量就必须转全检。
  // 少了这一步，`N=50` 遇上批量 10 会渲染 50 个输入格并抽 50 件 —— 就是规格说的"荒谬值"。
  const cap = (plan) => {
    if (lot >= 2 && plan.sampleSize >= lot) {
      return { ...plan, sampleSize: lot, fullInspection: true };
    }
    return plan;
  };

  // 分支 1：固定样本量 N=x
  const m = /^N\s*=\s*(\d+)/i.exec(scheme);
  if (m) {
    return cap({
      sampleSize: Number(m[1]), ac: fallback.ac, re: fallback.re || 1,
      strictness: 'fixed', applied: false, planText: scheme, fallback: false, fullInspection: false,
    });
  }

  // 分支 2：全检 / 免检 / 自定义文本 → 沿用模板值
  const lv = normalizeLevel(scheme || 'G-II');
  const looksLikeStd = /^(S-[1-4]|S[1-4]|I{1,3}|G-?I{1,3}|[123])$/i.test(
    toHalfWidth(scheme).replace(/[\s_]/g, '').replace(/[ⅠⅡⅢ]/g, (c) => ({ 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III' }[c]))
  );
  if (scheme && !looksLikeStd) {
    return cap({
      ...fallback, strictness: 'fixed', applied: false, planText: scheme, fallback: false, fullInspection: false,
    });
  }

  // 分支 3：国标方案 → 查表
  try {
    const plan = calculateSamplingPlan({
      lotSize,
      inspectionLevel: lv,
      aql: item.aql || '0.40',
      strictness: materialStrictness,
    });
    return { ...plan, planText: scheme || plan.inspectionLevel, fallback: plan.fallback };
  } catch {
    // 查表抛错（批量 < 2 等）属于兜底，必须带 fallback=true 让报告打 ⚠️（§5.8）
    return cap({
      ...fallback, strictness: 'fixed', applied: false, planText: scheme,
      fallback: true, fullInspection: false,
    });
  }
}

/** 批量计算（给 sheet 用；同一批量下逐项推定） */
export function planForItems(items = [], lotSize, materialStrictness = 'normal') {
  return items.map((it) => ({ ...it, plan: planForItem(it, lotSize, materialStrictness) }));
}
