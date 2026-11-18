// ============================================================
// wms-client —— OA → WMS 出站调用（P1）
//
// 只做三件事：拼地址、带 X-Api-Key、把结果与失败都落 iqc_sync_log。
// 纪律：
//   · 超时 15s（WMS 的落账是单事务，15s 足够；超时即视为失败让用户重试，
//     因为 WMS 侧有 CAS 幂等，重试不会重复落账）；
//   · **不吞错**：409 原样上抛（表示"已在 WMS 处理"），其它转 502；
//   · 每次调用都写日志 —— 跨系统问题排查全靠它。
// ============================================================
import { query } from '../db/index.js';
import { getWmsClientConfig } from './integration-config.js';

const baseUrl = () => getWmsClientConfig().baseUrl;
const apiKey = () => getWmsClientConfig().apiKey;

async function log(action, bizKey, status, ok, text) {
  try {
    await query(
      `INSERT INTO iqc_sync_log (direction, action, biz_key, attempt, http_status, ok, response)
       VALUES ('out', $1, $2, 1, $3, $4, $5)`,
      [action, String(bizKey || '').slice(0, 80), status || null, !!ok, String(text || '').slice(0, 2000)]
    );
  } catch { /* 日志失败不影响主流程 */ }
}

function bizKeyOf(body) {
  return body?.lotNo || body?.reportNo || body?.mrbNo || '';
}

/**
 * @param {string} action 日志用的动作名（claim/release/result/approve/reviewable）
 * @param {string} path   WMS 路径
 * @param {object} body
 */
export async function wmsCall(action, path, body = {}, opts = {}) {
  if (!apiKey()) {
    throw Object.assign(new Error('WMS_API_KEY 未配置，无法调用 WMS'), { statusCode: 500, isBiz: true });
  }
  const url = baseUrl() + path;
  let status = 0;
  let text = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey() },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
    text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    // 纯计算类调用（如抽样方案）不写同步日志，否则每次点算都堆一条
    if (!opts.quiet) await log(action, bizKeyOf(body), status, res.ok, text);

    if (!res.ok) {
      // NestJS 的异常体是 { statusCode, message, error }，有时 error 本身又是对象；
      // 逐层取到人类可读的那一句，避免把整串 JSON 甩到界面上
      const raw = json?.message
        || (typeof json?.error === 'string' ? json.error : json?.error?.message)
        || text.slice(0, 200)
        || `HTTP ${status}`;
      const msg = Array.isArray(raw) ? raw.join('；') : String(raw);
      // 409 = WMS 侧已处理（或已被认领）：原样上抛让前端给出准确提示
      throw Object.assign(new Error(`WMS：${msg}`), {
        statusCode: status === 409 ? 409 : 502,
        isBiz: true,
      });
    }
    return json;
  } catch (err) {
    if (!status) {
      // 网络层失败（超时/拒连）：也记一笔，便于对账时区分"没发出去"和"发了失败"
      if (!opts.quiet) await log(action, bizKeyOf(body), 0, false, err instanceof Error ? err.message : String(err));
      throw Object.assign(new Error(`调用 WMS 失败：${err instanceof Error ? err.message : err}`), {
        statusCode: 502,
        isBiz: true,
      });
    }
    throw err;
  }
}

/** GET 版（可评审量等只读查询） */
export async function wmsGet(action, path, queryObj = {}) {
  if (!apiKey()) {
    throw Object.assign(new Error('WMS_API_KEY 未配置，无法调用 WMS'), { statusCode: 500, isBiz: true });
  }
  const qs = new URLSearchParams(
    Object.entries(queryObj).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${baseUrl()}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey() },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  await log(action, qs, res.status, res.ok, text);
  if (!res.ok) {
    throw Object.assign(new Error(`WMS：${json?.message || text.slice(0, 200) || res.status}`), {
      statusCode: 502, isBiz: true,
    });
  }
  return json;
}
