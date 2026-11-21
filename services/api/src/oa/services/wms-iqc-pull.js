// ============================================================
// wms-iqc-pull —— OA **主动**从 WMS 拉取待检批次，落 iqc_lot_mirror
//
// 为什么需要它（2026-10-25）：
//   原设计只有一条入站通道——WMS 的 oa_event_outbox 每 60s 推一批过来。
//   实际上 OA 侧 `sys_api_key` 长期为空，WMS 推过来的全部 401，退避 8 次后
//   被置 failed 且不再重试；于是 OA「品质管理 → IQC 检验」永远是「待检批次 0」。
//   把推送修好要动 WMS 的队列表；而 OA 本来就有 WMS 的登录账号，
//   直接按 WMS 待检页同一口径把清单拉过来，不依赖对方的分发状态。
//
// 与 receiveLot 的关系（重要）：
//   · receiveLot 走 iqc_event_inbox 幂等，一条 lotNo 只处理一次 —— 适合「推送」；
//   · 这里是**幂等 upsert**，每轮都刷新 WMS 侧快照字段，但**绝不覆盖** OA 侧状态
//     （status / claimed_by / claimed_at / record_id / template_id 全都不动）。
//     两条通道并存时谁先到谁建行，后来的只更新快照，不会互相踩。
//
// 字段口径（与 WMS 待检页同源）：
//   列表 GET /api/iqc/pending → 批次/物料/供应商/数量/库位/报检时间
//   严格度 GET /api/iqc/strictness/current?materialId= → normal|tightened|reduced|suspended|exempt
//     · 返回 null = WMS 侧没有该物料的严格度记录，WMS 自己也按 normal 处理；
//     · suspended 是「停检」闸门，必须原样带过来，否则 OA 会让本该停检的批次照常开单。
// ============================================================
import { query } from '../db/index.js';
import { getWmsLoginConfig } from './wms-iqc-live.js';

/** 单轮拉取上限：待检批次不是海量，5 页 × 100 足够；超了也只拉到 500 条 */
const MAX_PAGES = 5;
const PAGE_SIZE = 100;
const TIMEOUT_MS = 20000;

/** 严格度缓存：materialId → { value, exp }；同一物料一轮内只问一次 */
const strictnessCache = new Map();
const STRICTNESS_TTL_MS = 10 * 60 * 1000;

const trimBase = (u) => String(u || '').replace(/\/+$/, '');

let tokenCache = null;
async function getToken(cfg, force = false) {
  if (!force && tokenCache && tokenCache.key === cfg.username && tokenCache.exp > Date.now()) {
    return tokenCache.token;
  }
  const res = await fetch(`${trimBase(cfg.baseUrl)}/api/system/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: cfg.username, password: cfg.password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  const token = json?.data?.token || json?.token || '';
  if (!res.ok || !token) {
    throw Object.assign(new Error(`WMS 登录失败：${json?.error?.message || json?.message || res.status}`), { code: 'WMS_LOGIN_FAILED' });
  }
  tokenCache = { token, key: cfg.username, exp: Date.now() + 6 * 86400000 };
  return token;
}

/** 供对账等只读场景复用（不写库）：带 token 缓存、401 自动重登一次 */
export async function apiGet(cfg, path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${trimBase(cfg.baseUrl)}${path}${qs ? `?${qs}` : ''}`;
  const call = (t) => fetch(url, {
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let res = await call(await getToken(cfg));
  if (res.status === 401) {
    await res.text().catch(() => '');
    res = await call(await getToken(cfg, true));
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(`WMS ${path}：${json?.error?.message || json?.message || res.status}`), { code: 'WMS_CALL_FAILED' });
  }
  return json?.code !== undefined && 'data' in (json || {}) ? json.data : json;
}

/** 严格度：null 视为 normal（与 WMS 自身口径一致） */
async function strictnessOf(cfg, materialId) {
  if (!materialId) return null;
  const hit = strictnessCache.get(materialId);
  if (hit && hit.exp > Date.now()) return hit.value;
  let value = null;
  try {
    const r = await apiGet(cfg, '/api/iqc/strictness/current', { materialId });
    const s = r?.strictness;
    value = ['normal', 'tightened', 'reduced', 'suspended', 'exempt'].includes(s) ? s : null;
  } catch {
    value = null; // 查不到不阻断拉取；缺省口径 normal 与 WMS 一致
  }
  strictnessCache.set(materialId, { value, exp: Date.now() + STRICTNESS_TTL_MS });
  return value;
}

/** WMS 的 locationCodes 是 "001-A-0-1,001-A-0-2" 这种串；jsonb 列必须给合法 JSON 文本 */
function toLocations(raw) {
  if (!raw) return null;
  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,;，；]/).map((s) => s.trim()).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : null;
}

/** 模板匹配：物料绑定 → 最新启用的 IQC 模板（与 oa-iqc-service.matchTemplate 同口径） */
async function bindTemplates(rows) {
  const codes = [...new Set(rows.map((r) => r.material_code).filter(Boolean))];
  if (!codes.length) return new Map();
  const res = await query(
    `SELECT DISTINCT ON (m.material_code) m.material_code, t.id
       FROM iqc_template_material m
       JOIN iqc_template t ON t.id = m.template_id
      WHERE m.material_code = ANY($1::text[]) AND t.status = 'active' AND t.library_scope = 'iqc'
      ORDER BY m.material_code, t.updated_at DESC, t.id DESC`,
    [codes]
  );
  return new Map(res.rows.map((r) => [r.material_code, r.id]));
}

/**
 * 拉一轮待检批次。
 * @returns {{ skipped?: boolean, reason?: string, fetched: number, inserted: number,
 *             updated: number, withTemplate: number, suspended: number, errors: string[] }}
 */
export async function pullPendingLots({ actor = null } = {}) {
  const cfg = await getWmsLoginConfig();
  if (!cfg) return { skipped: true, reason: '未配置 WMS 登录账号', fetched: 0, inserted: 0, updated: 0 };

  const errors = [];
  const items = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    let page;
    try {
      page = await apiGet(cfg, '/api/iqc/pending', {
        page: p, pageSize: PAGE_SIZE, statuses: 'pending,rejected',
      });
    } catch (e) {
      errors.push(`第 ${p} 页：${e.message}`);
      break;
    }
    const arr = Array.isArray(page?.items) ? page.items : [];
    items.push(...arr);
    const total = Number(page?.total) || 0;
    if (!arr.length || items.length >= total) break;
  }

  const seen = new Set();
  let inserted = 0;
  let updated = 0;
  let suspended = 0;
  const touched = [];

  for (const it of items) {
    const lotNo = String(it.lotNo || '').trim();
    if (!lotNo || seen.has(lotNo)) continue;
    seen.add(lotNo);

    const strictness = await strictnessOf(cfg, it.materialId);
    if (strictness === 'suspended') suspended++;

    const sampling = {
      strictness: strictness || 'normal',
      strictnessSource: 'wms-pull',
      pulledAt: new Date().toISOString(),
    };

    try {
      // 勾选说明：DO UPDATE 只碰 WMS 侧快照 + wms_status + payload，
      // status/claimed_by/claimed_at/record_id/template_id 一律不动（OA 主责）。
      const r = await query(
        `INSERT INTO iqc_lot_mirror
           (lot_no, inspection_no, receipt_date, supplier_code, supplier_name,
            material_code, material_name, qty, unit, batch_no, locations, sampling,
            wms_status, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (lot_no) DO UPDATE SET
           inspection_no = COALESCE(EXCLUDED.inspection_no, iqc_lot_mirror.inspection_no),
           receipt_date  = COALESCE(EXCLUDED.receipt_date,  iqc_lot_mirror.receipt_date),
           supplier_code = COALESCE(EXCLUDED.supplier_code, iqc_lot_mirror.supplier_code),
           supplier_name = COALESCE(EXCLUDED.supplier_name, iqc_lot_mirror.supplier_name),
           material_code = COALESCE(EXCLUDED.material_code, iqc_lot_mirror.material_code),
           material_name = COALESCE(EXCLUDED.material_name, iqc_lot_mirror.material_name),
           qty           = COALESCE(EXCLUDED.qty,           iqc_lot_mirror.qty),
           unit          = COALESCE(EXCLUDED.unit,          iqc_lot_mirror.unit),
           batch_no      = COALESCE(EXCLUDED.batch_no,      iqc_lot_mirror.batch_no),
           locations     = COALESCE(EXCLUDED.locations,     iqc_lot_mirror.locations),
           sampling      = COALESCE(iqc_lot_mirror.sampling, EXCLUDED.sampling),
           wms_status    = EXCLUDED.wms_status,
           payload       = EXCLUDED.payload,
           updated_at    = now()
         RETURNING id, (xmax = 0) AS inserted, material_code, template_id`,
        [
          lotNo,
          it.inspectionNo || null,
          it.receiptDate ? String(it.receiptDate).slice(0, 10) : null,
          it.supplierCode || null,
          it.supplierName || null,
          it.materialCode || null,
          it.materialName || null,
          it.totalQty ?? null,
          it.unit || null,
          it.batchNo || null,
          toLocations(it.locationCodes),
          JSON.stringify(sampling),
          it.status || null,
          JSON.stringify({ source: 'wms-pull', raw: it, actor }),
        ]
      );
      const row = r.rows[0];
      if (row?.inserted) { inserted++; touched.push(row); } else { updated++; }
    } catch (e) {
      errors.push(`${lotNo}：${e.message}`);
    }
  }

  // 新行补模板绑定（老行不覆盖用户现场选过的模板）
  let withTemplate = 0;
  const needTpl = touched.filter((r) => !r.template_id && r.material_code);
  if (needTpl.length) {
    try {
      const map = await bindTemplates(needTpl);
      for (const row of needTpl) {
        const tplId = map.get(row.material_code);
        if (!tplId) continue;
        await query(`UPDATE iqc_lot_mirror SET template_id = $1, updated_at = now() WHERE id = $2`, [tplId, row.id]);
        withTemplate++;
      }
    } catch (e) {
      errors.push(`模板绑定：${e.message}`);
    }
  }

  const closed = await closeFinishedInWms(cfg, seen, errors).catch((e) => {
    errors.push(`收口：${e.message}`);
    return 0;
  });

  return {
    fetched: items.length, inserted, updated, withTemplate, suspended, closed, errors,
    at: new Date().toISOString(),
  };
}

/**
 * 第二步：收口。
 *
 * 为什么必须做：本服务只拉 pending/rejected，而 WMS 那边每天仍在检。
 * 一批 WMS 检完的批次不会出现在待检列表里，但 OA 的镜像行还停在 pending ——
 * 页面上就会积压一堆「其实 WMS 早检完了」的假待检。用户对假数据零容忍。
 *
 * 处理口径：
 *   · 只在 OA **从未介入**（status='pending'）时收口，标 `wms_closed`；
 *   · 已认领/在检/已提交的行绝不自动改状态（那是 OA 的业务数据，只能人来定），
 *     发现 WMS 已终态只记一条告警，交对账任务暴露；
 *   · `wms_closed` 在 listLots 里默认过滤掉，页面上等于"消失"，但数据留着可追溯。
 */
async function closeFinishedInWms(cfg, seenThisRound, errors) {
  const WMS_FINAL = new Set(['pass', 'fail', 'inspecting', 'reviewing']);
  const byStatus = new Map(); // wmsStatus -> lotNo[]
  let total = 0;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const page = await apiGet(cfg, '/api/iqc/pending', { page: p, pageSize: PAGE_SIZE });
    const arr = Array.isArray(page?.items) ? page.items : [];
    total = Number(page?.total) || total;
    for (const it of arr) {
      const lotNo = String(it.lotNo || '').trim();
      if (!lotNo || seenThisRound.has(lotNo)) continue;
      const st = String(it.status || '');
      if (!WMS_FINAL.has(st)) continue;
      if (!byStatus.has(st)) byStatus.set(st, []);
      byStatus.get(st).push(lotNo);
    }
    if (!arr.length || (total && p * PAGE_SIZE >= total)) break;
  }

  let closed = 0;
  for (const [st, lotNos] of byStatus) {
    if (!lotNos.length) continue;
    const r = await query(
      `UPDATE iqc_lot_mirror AS m
          SET status = 'wms_closed', wms_status = $2, updated_at = now()
         FROM (SELECT unnest($1::text[]) AS lot_no) u
        WHERE m.lot_no = u.lot_no AND m.status = 'pending'`,
      [lotNos, st]
    );
    closed += r.rowCount || 0;

    // OA 已介入但 WMS 侧已到终态 → 冲突，交给对账/人工，不静默改
    const conflict = await query(
      `SELECT lot_no, status FROM iqc_lot_mirror
        WHERE lot_no = ANY($1::text[]) AND status <> 'pending' AND status <> 'wms_closed'`,
      [lotNos]
    );
    if (conflict.rows.length) {
      errors.push(`WMS 已${st} 但 OA 侧仍在处理：${conflict.rows.slice(0, 3).map((x) => `${x.lot_no}(${x.status})`).join('、')}`);
    }
  }
  return closed;
}


/** 清缓存（改了 WMS 账号或想立刻重新拉时用） */
export function resetPullCache() {
  strictnessCache.clear();
  tokenCache = null;
}
