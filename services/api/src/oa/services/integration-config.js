// ============================================================
// integration-config —— 外部系统对接配置中心
//
// 目标：OA 部署到任意机器后，管理员在 /integration-setup.html 填入
//       目标 WMS 信息 → 测试 → 保存，即热生效（无需改 .env、无需重启）。
//
// 存储：sys_integration 单行表；密码类字段 AES-256-GCM 加密。
// 读取优先级：数据库配置 > .env（保证老部署兼容）。
// 缓存：内存缓存 + 60s TTL；保存后立即失效并重建 WMS 连接池。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { one, many, query } from '../db/index.js';
import { config } from '../config/index.js';

const { Client } = pg;

const KEY_FILE = path.join(config.root, 'data', 'integration.key');
let cache = null;
let loading = null;

/* ---------------- 加密 ---------------- */
function ensureKey() {
  try {
    if (!fs.existsSync(KEY_FILE)) {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      const key = crypto.randomBytes(32);
      fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
      return key;
    }
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) throw new Error('integration.key 长度非法');
    return key;
  } catch (e) {
    console.warn('[integration] 读取密钥失败：', e.message);
    return null;
  }
}

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const key = ensureKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(enc) {
  if (!enc || typeof enc !== 'string' || !enc.startsWith('v1:')) return '';
  try {
    const key = ensureKey();
    if (!key) return '';
    const [, ivB64, tagB64, ctB64] = enc.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    console.warn('[integration] 密文解密失败（可能密钥已更换）：', e.message);
    return '';
  }
}

/* ---------------- 环境变量兜底 ---------------- */
function envDb() {
  return {
    host: process.env.WMS_DB_HOST || '127.0.0.1',
    port: Number(process.env.WMS_DB_PORT || 5432),
    database: process.env.WMS_DB_NAME || 'wms',
    user: process.env.WMS_DB_USER || 'postgres',
    password: process.env.WMS_DB_PASSWORD || '',
  };
}
function envWebhook() {
  return {
    url: process.env.WMS_WEBHOOK_URL || '',
    secret: process.env.WMS_WEBHOOK_SECRET || '',
  };
}
function envClient() {
  return {
    baseUrl: (process.env.WMS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    apiKey: process.env.WMS_API_KEY || '',
  };
}

/* ---------------- 读取与缓存 ---------------- */
async function readRow() {
  try {
    return await one(`SELECT * FROM sys_integration WHERE id = 1`);
  } catch (e) {
    // 迁移尚未执行时不要把服务打挂
    console.warn('[integration] 读取配置表失败（迁移未执行？）：', e.message);
    return null;
  }
}

function buildCache(row) {
  const eDb = envDb();
  const eWh = envWebhook();
  const eCl = envClient();

  const db = row
    ? {
        host: row.wms_db_host || eDb.host,
        port: Number(row.wms_db_port || eDb.port || 5432),
        database: row.wms_db_name || eDb.database,
        user: row.wms_db_user || eDb.user,
        password: decrypt(row.wms_db_password_enc) || eDb.password,
      }
    : eDb;

  const webhook = row
    ? {
        url: row.wms_webhook_url || eWh.url,
        secret: decrypt(row.wms_webhook_secret_enc) || eWh.secret,
      }
    : eWh;

  const client = row
    ? {
        baseUrl: (row.wms_base_url || eCl.baseUrl).replace(/\/+$/, ''),
        apiKey: decrypt(row.wms_api_key_enc) || eCl.apiKey,
      }
    : eCl;

  return {
    db,
    webhook,
    client,
    oaServiceUserId: row?.oa_service_user_id ?? null,
    source: row && (row.wms_db_password_enc || row.wms_db_host || row.wms_webhook_url || row.wms_base_url) ? 'db' : 'env',
    lastTestAt: row?.last_test_at || null,
    lastTestOk: row?.last_test_ok ?? null,
    lastTestError: row?.last_test_error || null,
    updatedAt: row?.updated_at || null,
    loadedAt: Date.now(),
  };
}

/** 确保配置已加载（启动时、保存后、或缓存过期 60s 自动刷新） */
export async function ensureIntegrationLoaded(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < 60_000) return cache;
  if (loading) return loading;
  loading = (async () => {
    const row = await readRow();
    cache = buildCache(row);
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

export function getWmsDbConfig() {
  return cache?.db || envDb();
}
export function getWmsWebhookConfig() {
  return cache?.webhook || envWebhook();
}
export function getWmsClientConfig() {
  return cache?.client || envClient();
}

/* ---------------- 保存 ---------------- */
function pickSecret(incoming, existingEnc) {
  // 传入空/未传 → 保留原密文；传入非空 → 重新加密
  if (incoming === undefined || incoming === null || incoming === '') return existingEnc || null;
  return encrypt(incoming);
}

// 供其他服务复用同一把密钥（如 wms-iqc-live 校验/写入密文）
export { encrypt as encryptSecret, decrypt as decryptSecret };

export async function saveIntegrationConfig(patch = {}, userId = null) {
  const existing = (await readRow()) || {};
  const num = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
  };

  const row = {
    wms_db_host: patch.wmsDbHost !== undefined ? String(patch.wmsDbHost || '').trim() || null : existing.wms_db_host,
    wms_db_port: patch.wmsDbPort !== undefined ? num(patch.wmsDbPort, null) : existing.wms_db_port,
    wms_db_name: patch.wmsDbName !== undefined ? String(patch.wmsDbName || '').trim() || null : existing.wms_db_name,
    wms_db_user: patch.wmsDbUser !== undefined ? String(patch.wmsDbUser || '').trim() || null : existing.wms_db_user,
    wms_db_password_enc: patch.wmsDbPassword !== undefined
      ? pickSecret(patch.wmsDbPassword, existing.wms_db_password_enc)
      : existing.wms_db_password_enc,
    wms_webhook_url: patch.wmsWebhookUrl !== undefined ? String(patch.wmsWebhookUrl || '').trim() || null : existing.wms_webhook_url,
    wms_webhook_secret_enc: patch.wmsWebhookSecret !== undefined
      ? pickSecret(patch.wmsWebhookSecret, existing.wms_webhook_secret_enc)
      : existing.wms_webhook_secret_enc,
    wms_base_url: patch.wmsBaseUrl !== undefined ? String(patch.wmsBaseUrl || '').trim() || null : existing.wms_base_url,
    wms_api_key_enc: patch.wmsApiKey !== undefined
      ? pickSecret(patch.wmsApiKey, existing.wms_api_key_enc)
      : existing.wms_api_key_enc,
    oa_service_user_id: patch.oaServiceUserId !== undefined
      ? num(patch.oaServiceUserId, null)
      : existing.oa_service_user_id,
  };

  await query(
    `INSERT INTO sys_integration
       (id, wms_db_host, wms_db_port, wms_db_name, wms_db_user, wms_db_password_enc,
        wms_webhook_url, wms_webhook_secret_enc, wms_base_url, wms_api_key_enc,
        oa_service_user_id, updated_at, updated_by)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11)
     ON CONFLICT (id) DO UPDATE SET
       wms_db_host = EXCLUDED.wms_db_host,
       wms_db_port = EXCLUDED.wms_db_port,
       wms_db_name = EXCLUDED.wms_db_name,
       wms_db_user = EXCLUDED.wms_db_user,
       wms_db_password_enc = EXCLUDED.wms_db_password_enc,
       wms_webhook_url = EXCLUDED.wms_webhook_url,
       wms_webhook_secret_enc = EXCLUDED.wms_webhook_secret_enc,
       wms_base_url = EXCLUDED.wms_base_url,
       wms_api_key_enc = EXCLUDED.wms_api_key_enc,
       oa_service_user_id = EXCLUDED.oa_service_user_id,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    [
      row.wms_db_host, row.wms_db_port, row.wms_db_name, row.wms_db_user, row.wms_db_password_enc,
      row.wms_webhook_url, row.wms_webhook_secret_enc, row.wms_base_url, row.wms_api_key_enc,
      row.oa_service_user_id, userId,
    ]
  );

  await ensureIntegrationLoaded(true);
  // 连接池重建，让新配置立即生效（动态引入避免循环依赖）
  try {
    const { resetWmsPool } = await import('../db/wms.js');
    resetWmsPool();
  } catch { /* ignore */ }
  return true;
}

/* ---------------- 连通性测试 ---------------- */
const WMS_TABLES = ['sys_param', 'iqc_lot', 'material', 'supplier'];

export async function testIntegration(overrides = {}) {
  await ensureIntegrationLoaded();
  const cur = cache || buildCache(null);
  const hasOverride = Object.keys(overrides || {}).length > 0;

  const dbCfg = {
    host: overrides.wmsDbHost || cur.db.host,
    port: Number(overrides.wmsDbPort || cur.db.port || 5432),
    database: overrides.wmsDbName || cur.db.database,
    user: overrides.wmsDbUser || cur.db.user,
    password: overrides.wmsDbPassword ? overrides.wmsDbPassword : cur.db.password,
  };
  const whCfg = {
    url: overrides.wmsWebhookUrl !== undefined ? overrides.wmsWebhookUrl : cur.webhook.url,
  };
  const clCfg = {
    baseUrl: (overrides.wmsBaseUrl !== undefined ? overrides.wmsBaseUrl : cur.client.baseUrl) || '',
  };

  // 1) WMS 数据库
  const dbRes = { ok: false, error: '', tables: [], latencyMs: 0 };
  if (!dbCfg.password) {
    dbRes.error = '未填写数据库密码（WMS_DB_PASSWORD 为空）';
  } else {
    const t0 = Date.now();
    const c = new Client({ ...dbCfg, connectionTimeoutMillis: 5000 });
    try {
      await c.connect();
      await c.query('SELECT 1');
      const r = await c.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name = ANY($1)`,
        [WMS_TABLES]
      );
      const have = new Set(r.rows.map((x) => x.table_name));
      dbRes.tables = WMS_TABLES.map((t) => ({ table: t, ok: have.has(t) }));
      dbRes.ok = WMS_TABLES.every((t) => have.has(t));
      if (!dbRes.ok) {
        dbRes.error = '已连上数据库，但缺少 OA 需要的表：'
          + WMS_TABLES.filter((t) => !have.has(t)).join(', ');
      }
    } catch (e) {
      dbRes.error = e.message;
    } finally {
      await c.end().catch(() => {});
      dbRes.latencyMs = Date.now() - t0;
    }
  }

  // 2) Webhook 可达性（仅探测 HTTP 是否可达，不触发业务）
  const whRes = { ok: null, error: '', status: null };
  if (whCfg.url) {
    try {
      const res = await fetch(whCfg.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      whRes.status = res.status;
      whRes.ok = true; // 有 HTTP 响应即视为可达（404/405 也说明网络通）
    } catch (e) {
      whRes.ok = false;
      whRes.error = e.message;
    }
  }

  // 3) WMS API 可达性
  const clRes = { ok: null, error: '', status: null };
  if (clCfg.baseUrl) {
    try {
      const res = await fetch(clCfg.baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      clRes.status = res.status;
      clRes.ok = true;
    } catch (e) {
      clRes.ok = false;
      clRes.error = e.message;
    }
  }

  const result = { db: dbRes, webhook: whRes, client: clRes, at: new Date().toISOString(), testedOverrides: hasOverride };

  // 只有测试"已保存的当前配置"时才回写测试结果
  if (!hasOverride) {
    try {
      await query(
        `UPDATE sys_integration SET last_test_at = now(), last_test_ok = $1, last_test_error = $2 WHERE id = 1`,
        [dbRes.ok, dbRes.ok ? null : String(dbRes.error || '').slice(0, 500)]
      );
      await ensureIntegrationLoaded(true);
    } catch { /* ignore */ }
  }
  return result;
}

/* ---------------- 对外（管理员界面） ---------------- */
export async function getIntegrationConfigForAdmin() {
  await ensureIntegrationLoaded();
  const c = cache || buildCache(null);
  return {
    wmsDbHost: c.db.host,
    wmsDbPort: c.db.port,
    wmsDbName: c.db.database,
    wmsDbUser: c.db.user,
    hasDbPassword: !!c.db.password,
    wmsDbPassword: '',
    wmsWebhookUrl: c.webhook.url,
    hasWebhookSecret: !!c.webhook.secret,
    wmsWebhookSecret: '',
    wmsBaseUrl: c.client.baseUrl,
    hasApiKey: !!c.client.apiKey,
    wmsApiKey: '',
    oaServiceUserId: c.oaServiceUserId,
    source: c.source,
    lastTestAt: c.lastTestAt,
    lastTestOk: c.lastTestOk,
    lastTestError: c.lastTestError,
    updatedAt: c.updatedAt,
  };
}

export async function getIntegrationStatus() {
  await ensureIntegrationLoaded();
  let available = false;
  try {
    const { wmsPing } = await import('../db/wms.js');
    available = await wmsPing();
  } catch { /* ignore */ }
  const c = cache || buildCache(null);
  return {
    available,
    source: c.source,
    lastTestAt: c.lastTestAt,
    lastTestOk: c.lastTestOk,
    lastTestError: c.lastTestError,
  };
}

/* ============================================================
 * 多系统连接（WMS / MES …）
 *   - 与 WMS 只读库配置分离；这里管「HTTP 接口 + Webhook」
 * ============================================================ */
let systemsCache = null;
let systemsLoading = null;

async function readSystemRows() {
  try {
    return await many(`SELECT * FROM sys_integration_system ORDER BY system_code`);
  } catch (e) {
    console.warn('[integration] 读取系统连接失败（迁移未执行？）：', e.message);
    return [];
  }
}

async function loadSystems(force = false) {
  if (!force && systemsCache && Date.now() - systemsCache.at < 60_000) return systemsCache.map;
  if (systemsLoading) return systemsLoading;
  systemsLoading = (async () => {
    const rows = await readSystemRows();
    const map = new Map();
    for (const r of rows) {
      map.set(r.system_code, {
        code: r.system_code,
        name: r.name,
        baseUrl: (r.base_url || '').replace(/\/+$/, ''),
        apiKey: decrypt(r.api_key_enc),
        username: r.username || '',
        password: decrypt(r.password_enc),
        webhookUrl: r.webhook_url || '',
        webhookSecret: decrypt(r.webhook_secret_enc),
        enabled: r.enabled !== false,
        lastTestAt: r.last_test_at,
        lastTestOk: r.last_test_ok,
        lastTestError: r.last_test_error,
      });
    }
    systemsCache = { map, at: Date.now() };
    return map;
  })().finally(() => { systemsLoading = null; });
  return systemsLoading;
}

/** 取某外部系统的连接配置（不存在返回 null） */
export async function getSystemConfig(code) {
  const map = await loadSystems();
  const c = map.get(String(code || '').trim().toUpperCase());
  if (c) return c;
  // 兜底：WMS 沿用旧配置（sys_integration / .env）
  if (String(code || '').trim().toUpperCase() === 'WMS') {
    const db = getWmsClientConfig();
    const wh = getWmsWebhookConfig();
    return {
      code: 'WMS', name: 'WMS 仓储系统',
      baseUrl: db.baseUrl, apiKey: db.apiKey,
      webhookUrl: wh.url, webhookSecret: wh.secret, enabled: true,
    };
  }
  return null;
}

export async function listSystemsForAdmin() {
  const map = await loadSystems(true);
  const out = [];
  for (const c of map.values()) {
    out.push({
      systemCode: c.code, name: c.name, baseUrl: c.baseUrl,
      hasApiKey: !!c.apiKey, webhookUrl: c.webhookUrl,
      username: c.username || '',
      hasPassword: !!c.password,
      hasWebhookSecret: !!c.webhookSecret, enabled: c.enabled,
      lastTestAt: c.lastTestAt, lastTestOk: c.lastTestOk, lastTestError: c.lastTestError,
    });
  }
  return out;
}

/** 保存某外部系统连接；密钥留空表示不修改 */
export async function saveSystemConfig(code, patch = {}, userId = null) {
  const sc = String(code || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(sc)) throw new Error('系统编码格式不合法');
  const existing = (await readSystemRows()).find((r) => r.system_code === sc) || {};
  const row = {
    name: patch.name !== undefined ? (String(patch.name || '').trim() || sc) : (existing.name || sc),
    base_url: patch.baseUrl !== undefined ? (String(patch.baseUrl || '').trim() || null) : existing.base_url,
    api_key_enc: patch.apiKey !== undefined ? pickSecret(patch.apiKey, existing.api_key_enc) : existing.api_key_enc,
    username: patch.username !== undefined ? (String(patch.username || '').trim() || null) : existing.username,
    password_enc: patch.password !== undefined ? pickSecret(patch.password, existing.password_enc) : existing.password_enc,
    webhook_url: patch.webhookUrl !== undefined ? (String(patch.webhookUrl || '').trim() || null) : existing.webhook_url,
    webhook_secret_enc: patch.webhookSecret !== undefined ? pickSecret(patch.webhookSecret, existing.webhook_secret_enc) : existing.webhook_secret_enc,
    enabled: patch.enabled !== undefined ? !!patch.enabled : (existing.enabled !== false),
  };
  await query(
    `INSERT INTO sys_integration_system
       (system_code, name, base_url, api_key_enc, username, password_enc,
        webhook_url, webhook_secret_enc, enabled, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10)
     ON CONFLICT (system_code) DO UPDATE SET
       name=EXCLUDED.name, base_url=EXCLUDED.base_url, api_key_enc=EXCLUDED.api_key_enc,
       username=EXCLUDED.username, password_enc=EXCLUDED.password_enc,
       webhook_url=EXCLUDED.webhook_url, webhook_secret_enc=EXCLUDED.webhook_secret_enc,
       enabled=EXCLUDED.enabled, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [sc, row.name, row.base_url, row.api_key_enc, row.username, row.password_enc,
     row.webhook_url, row.webhook_secret_enc, row.enabled, userId]
  );
  await loadSystems(true);
  return true;
}

/** 探测某系统的 HTTP 接口与 Webhook 是否可达 */
export async function testSystem(code, overrides = {}) {
  const c = (await getSystemConfig(code)) || {};
  const baseUrl = overrides.baseUrl !== undefined ? overrides.baseUrl : c.baseUrl;
  const webhookUrl = overrides.webhookUrl !== undefined ? overrides.webhookUrl : c.webhookUrl;
  const username = overrides.username !== undefined ? overrides.username : c.username;
  const password = overrides.password ? overrides.password : c.password;
  const out = {
    base: { ok: null, status: null, error: '' },
    webhook: { ok: null, status: null, error: '' },
    login: { ok: null, status: null, error: '', tried: false },
  };
  const probe = async (url, target) => {
    if (!url) return;
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      target.status = res.status; target.ok = true;
    } catch (e) {
      target.ok = false; target.error = e.message;
    }
  };
  await probe(baseUrl, out.base);
  await probe(webhookUrl, out.webhook);

  // 登录探测：只测「账号能不能登上」，不保存 token。
  // 这一步才是决定「实时数据能不能拉到」的关键，端口通不代表能登录。
  if (baseUrl && username && password) {
    out.login.tried = true;
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/system/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: username, password }),
        signal: AbortSignal.timeout(8000),
      });
      out.login.status = res.status;
      const text = await res.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(text); } catch { /* ignore */ }
      const token = json?.data?.token || json?.token;
      if (res.ok && token) {
        out.login.ok = true;
      } else {
        out.login.ok = false;
        const msg = json?.error?.message || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
        out.login.error = String(msg);
      }
    } catch (e) {
      out.login.ok = false;
      out.login.error = e.message;
    }
  }

  try {
    // 只要「接口可达」且「登录（若尝试）成功」就记成功，便于控制台一眼看出卡在哪
    const overallOk = out.base.ok !== false && out.login.ok !== false;
    const errText = out.login.ok === false
      ? `登录失败：${out.login.error}`
      : (out.base.ok === false ? String(out.base.error || '') : null);
    await query(
      `UPDATE sys_integration_system SET last_test_at=now(), last_test_ok=$2, last_test_error=$3 WHERE system_code=$1`,
      [String(code).toUpperCase(), overallOk, errText ? String(errText).slice(0, 500) : null]
    );
    await loadSystems(true);
  } catch { /* ignore */ }
  return out;
}
