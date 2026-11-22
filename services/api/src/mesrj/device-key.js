/**
 * 设备密钥（X-Api-Key）校验 —— 所有 legacy 现场设备模块共用
 *
 * 源端（api/ultra.py、api/laser.py 等）的采集程序/工位屏/回读脚本都没有登录态，
 * 只有一张设备密钥。SMT 里这些路由注册在 router.use(authenticateJWT) 之前，
 * 逐个处理器调 keyOk() 自己鉴权；同时路径必须登记进 server.js 的
 * DEVICE_OPEN_PATHS，否则会被 api 层的 JWT 门先拦成 401。
 *
 * 密钥来源（与源端一致）：
 *   1. sys_api_key（enabled=1）—— SMT 已有的设备密钥台账
 *   2. sys_param 里的 ultrasonic.api_key / ultra.scan_key —— 现场脚本写死的历史键
 * 60 秒缓存，避免每个请求都打两张表；clearKeyCache() 用于密钥变更后立刻生效。
 *
 * ⚠ sys_api_key 有两套历史列（id/name/created_at 各重复一份），永远显式取列，
 *   绝不 SELECT *。
 */

const keyCache = { at: 0, keys: new Set() };

async function qrows(query, sql, params) {
  const r = await query(sql, params);
  return r?.rows ?? [];
}

export async function acceptedKeys(query) {
  if (Date.now() - keyCache.at < 60000 && keyCache.keys.size) return keyCache.keys;
  const keys = new Set();
  try {
    const rows = await qrows(query, "SELECT api_key FROM sys_api_key WHERE enabled = 1");
    for (const r of rows) {
      const v = String(r.api_key ?? "").trim();
      if (v) keys.add(v);
    }
  } catch { /* 表可能还没有数据 */ }
  for (const k of ["ultrasonic.api_key", "ultra.scan_key"]) {
    try {
      const rows = await qrows(query, "SELECT param_val FROM sys_param WHERE param_key = $1", [k]);
      const v = String(rows[0]?.param_val ?? "").trim();
      if (v) keys.add(v);
    } catch { /* ignore */ }
  }
  keyCache.at = Date.now();
  keyCache.keys = keys;
  return keys;
}

export function clearKeyCache() {
  keyCache.at = 0;
  keyCache.keys = new Set();
}

/** 请求是否带了有效设备密钥。缺 key / 错 key 都返回 false（调用方回 401）。 */
export async function keyOk(req, query) {
  const got = String(req.headers["x-api-key"] || "").trim();
  if (!got) return false;
  try {
    const keys = await acceptedKeys(query);
    return keys.has(got);
  } catch {
    return false;
  }
}