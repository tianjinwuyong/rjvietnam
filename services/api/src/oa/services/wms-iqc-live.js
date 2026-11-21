// ============================================================
// wms-iqc-live —— 从 WMS **实时**拉取 IQC 看板数据（HTTP）
//
// 为什么是 HTTP 而不是连库：
//   · WMS 的 PostgreSQL 端口在现网不可达（只放行 3000），直连库走不通；
//   · 跨库联动会把 OA 与 WMS 的表结构绑死，WMS 一改字段 OA 就崩；
//   · WMS 已有现成接口（/api/dashboard/iqc-*），口径与它自己的看板**完全一致**，
//     所以这里只做「搬运 + 字段改名」，绝不自己重算指标。
//
// 鉴权：用 WMS 的一个只读账号登录换 JWT（有效期 7 天），内存缓存 6 天。
//      账号密码存在 sys_integration_system（password_enc 为 AES 密文）。
//
// 纪律：
//   · 不缓存业务数据 —— 每次调用都真的去问 WMS，保证「实时」；
//   · 只缓存 token（那是登录凭证，不是数据）；
//   · 任何失败都抛出去，由上层决定降级，不在这里编造 0。
// ============================================================
import { getSystemConfig } from './integration-config.js';

/** WMS token 有效期 7d（见 WMS jwt-auth.guard.ts），这里缓存 6d 留安全边界 */
const TOKEN_TTL_MS = 6 * 24 * 3600 * 1000;
/** 单次请求超时 */
const TIMEOUT_MS = 15000;

let tokenCache = null; // { token, exp, key }

const trimBase = (u) => String(u || '').replace(/\/+$/, '');

function cfgKey(cfg) {
  return `${trimBase(cfg.baseUrl)}|${cfg.username}`;
}

/**
 * 取可用的 WMS 登录配置；未配置账号返回 null。
 * 这是「实时模式」的开关：配了账号就走实时，没配就退回原逻辑。
 */
export async function getWmsLoginConfig() {
  const cfg = await getSystemConfig('WMS');
  if (!cfg) return null;
  if (cfg.enabled === false) return null;
  if (!cfg.baseUrl || !cfg.username || !cfg.password) return null;
  return cfg;
}

/** 清掉缓存的 token（改了账号/密码后调用） */
export function resetWmsToken() {
  tokenCache = null;
}

function httpErr(message, extra = {}) {
  return Object.assign(new Error(message), { isBiz: true, ...extra });
}

/** 登录换 token；失败抛出可读错误 */
async function login(cfg, force = false) {
  const key = cfgKey(cfg);
  if (!force && tokenCache && tokenCache.key === key && tokenCache.exp > Date.now()) {
    return tokenCache.token;
  }
  let res;
  try {
    res = await fetch(`${trimBase(cfg.baseUrl)}/api/system/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw httpErr(`连接 WMS 失败（${trimBase(cfg.baseUrl)}）：${e.message}`, { code: 'WMS_UNREACHABLE' });
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  const token = json?.data?.token || json?.token || '';
  if (!res.ok || !token) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw httpErr(`WMS 登录失败：${msg}`, { code: 'WMS_LOGIN_FAILED', status: res.status });
  }
  tokenCache = { token, exp: Date.now() + TOKEN_TTL_MS, key };
  return token;
}

/** 去掉 {code,message,data} 外壳；dashboard 接口是裸数据，此时原样返回 */
function unwrap(json) {
  if (json && typeof json === 'object' && json.code !== undefined && 'data' in json) return json.data;
  return json;
}

/** GET 调用；401 时强制重登一次再试（应对 WMS 重启/密钥轮换） */
async function apiGet(cfg, path, query = {}) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${trimBase(cfg.baseUrl)}${path}${qs ? `?${qs}` : ''}`;

  const doFetch = (token) => fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let res;
  try {
    res = await doFetch(await login(cfg));
    if (res.status === 401) {
      await res.text().catch(() => '');
      res = await doFetch(await login(cfg, true));
    }
  } catch (e) {
    if (e.code) throw e; // 上面 login 抛的，已带可读信息
    throw httpErr(`调用 WMS 失败：${e.message}`, { code: 'WMS_CALL_FAILED' });
  }

  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    const code = res.status === 401 || res.status === 403 ? 'WMS_LOGIN_FAILED' : 'WMS_CALL_FAILED';
    throw httpErr(`WMS ${path}：${msg}`, { code, status: res.status });
  }
  return unwrap(json);
}

/** 读 WMS 的 sys_param 数字参数；读不到用默认值（不因参数接口失败拖垮看板） */
async function paramNumber(cfg, key, fallback) {
  try {
    const r = await apiGet(cfg, `/api/system/param/${encodeURIComponent(key)}`);
    const raw = r?.paramValue ?? r?.param_value ?? r?.value ?? r;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** 辅助调用：失败时返回默认值，但把错误记下来供排查 */
async function safe(promise, fallback, errors, label) {
  try {
    return await promise;
  } catch (e) {
    errors.push(`${label}: ${e.message}`);
    return fallback;
  }
}

function normRange(startDate, endDate) {
  const end = (endDate || '').trim() || new Date().toISOString().slice(0, 10);
  const start = (startDate || '').trim()
    || new Date(Date.parse(end) - 29 * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

function wmsWebPort(baseUrl) {
  try { return Number(new URL(baseUrl).port) || 3000; } catch { return 3000; }
}

/**
 * 实时 IQC 看板：汇总 + 趋势 + 两张分布 + 待检/超期。
 * 返回结构与 OA 原 getIqcDashboard 完全一致，前端无需改动。
 */
export async function getIqcDashboardLive({ startDate, endDate, granularity } = {}) {
  const cfg = await getWmsLoginConfig();
  if (!cfg) {
    throw httpErr('未配置 WMS 登录账号（系统对接 → WMS → 账号密码）', { code: 'WMS_LOGIN_NOT_CONFIGURED' });
  }

  const { start, end } = normRange(startDate, endDate);
  const gran = ['day', 'week', 'month'].includes(granularity) ? granularity : 'day';
  const errors = [];

  // 汇总+趋势：失败即整体失败（这是主数据，不能编）
  const stats = await apiGet(cfg, '/api/dashboard/iqc-stats', {
    startDate: start, endDate: end, granularity: gran,
  });

  const [overdue, pending, byType, byMat, warningHours, urgentHours] = await Promise.all([
    safe(apiGet(cfg, '/api/dashboard/iqc-overdue'), {}, errors, '超期统计'),
    safe(apiGet(cfg, '/api/dashboard/pending-stats'), {}, errors, '待检统计'),
    safe(apiGet(cfg, '/api/dashboard/iqc-defect-by-type', { startDate: start, endDate: end }), [], errors, '不良类型分布'),
    safe(apiGet(cfg, '/api/dashboard/iqc-defect-by-material-type', { startDate: start, endDate: end }), [], errors, '物料类型分布'),
    paramNumber(cfg, 'iqc_pending_warning_hours', 24),
    paramNumber(cfg, 'iqc_pending_urgent_hours', 48),
  ]);

  const s = stats?.summary || {};
  const totalLots = Number(s.totalLots) || 0;
  const passedLots = Number(s.passedLots) || 0;
  const failedLots = Number.isFinite(Number(s.failedLots)) ? Number(s.failedLots) : Math.max(0, totalLots - passedLots);

  // WMS 的 IqcTrendPoint: { date, totalLots, passedLots, passRate }
  // OA 前端要的是:        { bucket, total, passed, failed, passRate }
  const trend = (Array.isArray(stats?.trend) ? stats.trend : []).map((p) => {
    const total = Number(p.totalLots) || 0;
    const passed = Number(p.passedLots) || 0;
    return {
      bucket: String(p.date ?? p.bucket ?? ''),
      total,
      passed,
      failed: Math.max(0, total - passed),
      passRate: Number.isFinite(Number(p.passRate))
        ? Number(p.passRate)
        : (total ? Math.round((passed / total) * 1000) / 10 : 0),
    };
  });

  return {
    wmsAvailable: true,
    source: 'wms-http',
    fetchedAt: new Date().toISOString(),
    partialErrors: errors,
    links: {
      port: wmsWebPort(cfg.baseUrl),
      pendingPath: '/iqc/pending',
      recordsPath: '/iqc/record',
      statsPath: '/iqc/stats',
      base: trimBase(cfg.baseUrl),
    },
    range: { start, end, granularity: gran, warningHours, urgentHours },
    summary: {
      totalLots,
      passedLots,
      failedLots,
      passRate: Number.isFinite(Number(s.passRate))
        ? Number(s.passRate)
        : (totalLots ? Math.round((passedLots / totalLots) * 1000) / 10 : 0),
      targetPassRate: Number(s.targetPassRate) || 95,
      pending: Number(pending?.pendingCount) || 0,
      warning: Number(overdue?.warningCount) || 0,
      overdue: Number(overdue?.overdueCount) || 0,
    },
    trend,
    defectByType: (Array.isArray(byType) ? byType : []).map((r) => ({
      type: String(r.type ?? '未分类'),
      count: Number(r.count) || 0,
    })),
    defectByMaterialType: (Array.isArray(byMat) ? byMat : []).map((r) => ({
      materialType: String(r.materialType ?? '未分类'),
      count: Number(r.count) || 0,
    })),
  };
}

/** 筛选项（WMS 里 material material_type 的真实取值），供前端下拉 */
export async function getIqcFilterOptionsLive({ startDate, endDate } = {}) {
  const cfg = await getWmsLoginConfig();
  if (!cfg) return { materialTypes: [], suppliers: [] };
  const { start, end } = normRange(startDate, endDate);
  try {
    const stats = await apiGet(cfg, '/api/dashboard/iqc-stats', {
      startDate: start, endDate: end, granularity: 'day',
    });
    return {
      materialTypes: Array.isArray(stats?.materialTypes) ? stats.materialTypes : [],
      topSuppliers: Array.isArray(stats?.topSuppliers) ? stats.topSuppliers : [],
      topMaterials: Array.isArray(stats?.topMaterials) ? stats.topMaterials : [],
    };
  } catch {
    return { materialTypes: [], topSuppliers: [], topMaterials: [] };
  }
}

/**
 * 不良明细下钻：点饼图某扇区 → 列出对应批次。
 * 直接调 WMS 的 iqc-defect-detail，保证与扇区数值同源同口径。
 */
export async function getIqcDefectLotsLive({ startDate, endDate, type, materialType, page = 1, size = 20 } = {}) {
  const cfg = await getWmsLoginConfig();
  if (!cfg) {
    throw httpErr('未配置 WMS 登录账号（系统对接 → WMS → 账号密码）', { code: 'WMS_LOGIN_NOT_CONFIGURED' });
  }
  const { start, end } = normRange(startDate, endDate);
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(size) || 20));

  // OA 侧用 type / materialType 两个参数；WMS 用 dimension + value 二选一
  const dimension = type ? 'type' : (materialType ? 'materialType' : 'type');
  const value = type || materialType || '';

  const r = await apiGet(cfg, '/api/dashboard/iqc-defect-detail', {
    startDate: start, endDate: end, dimension, value, page: p, pageSize: s,
  });

  const items = Array.isArray(r?.items) ? r.items : [];
  return {
    wmsAvailable: true,
    source: 'wms-http',
    fetchedAt: new Date().toISOString(),
    total: Number(r?.total) || items.length,
    page: Number(r?.page) || p,
    size: Number(r?.pageSize) || s,
    list: items.map((it) => ({
      lotNo: it.lotNo || '',
      inspectionNo: it.reportNo || '',
      receiptDate: it.receiptDate ? String(it.receiptDate).slice(0, 10) : '',
      materialCode: it.materialCode || '',
      materialName: it.materialName || '',
      materialType: it.materialType || '',
      specification: '',
      supplierName: it.supplierName || '',
      supplierCode: it.supplierCode || '',
      defectType: it.mainDefectType || '',
      defectDescriptions: Array.isArray(it.defectDescriptions) ? it.defectDescriptions : [],
      totalQty: Number(it.totalQty) || 0,
      unit: it.unit || '',
      inspectionResult: it.inspectionResult || '',
      status: it.status || '',
      remark: Array.isArray(it.defectDescriptions) ? it.defectDescriptions.join('；') : '',
    })),
  };
}

/** 探测实时通道是否可用（控制台/健康检查用） */
export async function getWmsLiveStatus() {
  const cfg = await getWmsLoginConfig();
  if (!cfg) {
    return { configured: false, ok: false, message: '未配置 WMS 登录账号' };
  }
  try {
    await login(cfg, true);
    return {
      configured: true, ok: true,
      baseUrl: trimBase(cfg.baseUrl), username: cfg.username,
      message: '登录成功，实时通道可用',
    };
  } catch (e) {
    return {
      configured: true, ok: false,
      baseUrl: trimBase(cfg.baseUrl), username: cfg.username,
      code: e.code || '', message: e.message,
    };
  }
}
