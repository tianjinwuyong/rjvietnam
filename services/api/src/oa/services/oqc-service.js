// ============================================================
// oqc-service —— 出货检验（OQC）抽样方案（P3）
//
// 职责边界（同日裁决）：
//   · 抽样规则（国标 GB/T 2828.1 表 + 严格度）**只有一份**，在 WMS；
//   · OA 只做调用方与展示方，不复制表 —— 两套表一旦改错，
//     同一批会出现"OA 判 OK、WMS 判 NG"，且几乎无法察觉。
//
// 因此本服务只做：参数校验 → 调 WMS /api/oa/sampling → 原样返回结果。
// ============================================================
import { wmsCall } from './wms-client.js';

function bad(msg, statusCode = 400) {
  return Object.assign(new Error(msg), { statusCode, isBiz: true });
}

/** 可选值：与 WMS 抽样表对齐（改这里要同步 WMS sampling-plan.service.ts） */
export const SAMPLING_OPTIONS = {
  levels: ['S-1', 'S-2', 'S-3', 'S-4', 'I', 'II', 'III'],
  aql: ['0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0'],
  strictness: ['normal', 'tightened', 'reduced'],
};

/**
 * 计算一次抽样方案
 * @param {{lotSize:number|string, level?:string, aql?:string, strictness?:string}} q
 */
export async function computeSampling({ lotSize, level, aql, strictness } = {}) {
  const n = Math.trunc(Number(lotSize));
  if (!Number.isFinite(n) || n < 2) throw bad('批量必须为大于 1 的整数');

  const body = {
    lotSize: n,
    inspectionLevel: String(level || 'II'),
    aql: String(aql || '0.40'),
    strictness: ['normal', 'tightened', 'reduced'].includes(strictness) ? strictness : 'normal',
  };

  const r = await wmsCall('sampling', '/api/oa/sampling', body, { quiet: true });
  return {
    ...r,
    // 人话结论，前端直接展示，避免各处再拼一遍
    note: r.sampleSize >= n
      ? '样本量已达到批量，按全检处理'
      : `抽 ${r.sampleSize} 件：不良数 ≤ ${r.ac} 接收，≥ ${r.re} 拒收`,
  };
}
