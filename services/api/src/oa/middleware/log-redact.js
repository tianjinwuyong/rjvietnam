// 日志脱敏工具（B2）
//
// 背景：文件下载走 `/api/files/<rel>?token=<session>`（新窗口 / <a href> 无法带
// Authorization 头，只能把会话 token 放 query）。Fastify 默认的 req 序列化器会把
// `req.url` 整串写日志，onResponse 钩子也显式打印 `${req.method} ${req.url}`，
// 于是**会话 token 明文落盘**（实测历史日志 88 处 64 位 token）。
//
// 本模块只负责「日志输出」层面把敏感 query 值替换成 ***，
// **绝不改变请求处理逻辑**：认证中间件仍从 req.query.token 正常取 token，
// onRequest 的发布同步哨兵仍读 req.raw.url。二者都不经过这里。

/**
 * 需要脱敏的 query 参数名（小写精确匹配）。
 * 只做精确名单，避免误伤 `keyword` / `k` 这类普通参数。
 */
const SENSITIVE_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'api_secret',
  'password',
  'passwd',
  'pwd',
  'secret',
  'signature',
  'sign',
  'x-token',
]);

/** URL 解码失败时保留原文（可能是含 % 的合法文件名） */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 把 URL 中敏感 query 参数的值替换为 `***`。
 *
 * 行为保证：
 *   · 无 query 或无敏感参数时**原样返回**（输出与改造前逐字节一致）；
 *   · 只替换值，保留 key 名与参数顺序，便于排查「谁在下载什么」；
 *   · 不抛异常（日志路径上绝不能因脱敏失败而丢日志）。
 *
 * @param {string} url 形如 `/api/files/a/b.xlsx?token=xxx&dl=1`
 * @returns {string}
 */
export function redactUrl(url) {
  const raw = typeof url === 'string' ? url : String(url ?? '');
  if (!raw) return raw;

  const qIdx = raw.indexOf('?');
  if (qIdx < 0) return raw;

  const pathPart = raw.slice(0, qIdx);
  const queryPart = raw.slice(qIdx + 1);
  if (!queryPart) return raw;

  let dirty = false;
  const out = queryPart.split('&').map((pair) => {
    if (!pair) return pair;
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (!SENSITIVE_KEYS.has(safeDecode(key).toLowerCase())) return pair;
    dirty = true;
    return `${key}=***`;
  });

  return dirty ? `${pathPart}?${out.join('&')}` : raw;
}

/**
 * Fastify/pino 的 `req` 序列化器（替代默认实现）。
 *
 * 默认实现（node_modules/fastify/lib/logger-pino.js）输出
 * `{method, url, version, host, remoteAddress, remotePort}`，此处保持**完全相同的字段**，
 * 仅对 url 做脱敏 —— 保证日志结构与既有排查习惯（grep `"url":"/api/...`）不变。
 *
 * @param {import('node:http').IncomingMessage} req 原生请求对象
 * @returns {{method:string,url:string,version:string|undefined,host:string|undefined,
 *            remoteAddress:string|undefined,remotePort:number|undefined}}
 */
export function redactingReqSerializer(req) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    version: req.headers && req.headers['accept-version'],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket ? req.socket.remotePort : undefined,
  };
}
