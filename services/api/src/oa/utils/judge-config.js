// ============================================================
// judge-config —— 模板「判定规则配置」归一（巡线/首件/点检共用）
//
// 为什么单独成文件：三类模板分别在 ipqc-service 与 modules-service 里维护，
// 若各自写一份归一逻辑，迟早出现"巡线能存、点检存了查不出来"的漂移。
//
// 结构（与 sql/68 注释一致）：
//   mode      auto | columns | off
//   ruleType  measure（计量：SPEC 公差+数值） | count（计数：不良数 vs 上限） | attribute（定性：OK/NG 词表）
//   headerRows / specCol / measureCol / judgeCol / ac / re / countMax
// ============================================================

/**
 * 归一判定配置。
 * @param {*} v 输入（undefined=不修改；null/''=清空；对象或 JSON 字符串=设置）
 * @returns {object|null|undefined}
 */
export function normJudgeConfig(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  let obj = v;
  if (typeof v === 'string') {
    try { obj = JSON.parse(v); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;

  const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const out = {
    mode: ['auto', 'columns', 'off'].includes(obj.mode) ? obj.mode : 'auto',
    ruleType: ['measure', 'count', 'attribute'].includes(obj.ruleType) ? obj.ruleType : 'measure',
  };
  const hr = num(obj.headerRows);
  if (hr !== null) out.headerRows = Math.max(1, Math.min(5, hr));
  for (const k of ['specCol', 'measureCol', 'judgeCol']) {
    const n = num(obj[k]);
    if (n !== null) out[k] = Math.max(0, n);
  }
  for (const k of ['ac', 're', 'countMax']) {
    const n = num(obj[k]);
    if (n !== null) out[k] = n;
  }
  return out;
}

export default { normJudgeConfig };
