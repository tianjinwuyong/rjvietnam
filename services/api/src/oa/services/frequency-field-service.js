// ============================================================
// 频次与自定义字段 —— 通用服务（第 38 轮）
// ------------------------------------------------------------
// 用途：
//   1. 检查项「项级频率」派生（点检 / IPQC 通用）
//   2. 模板「自定义字段」定义 CRUD + 值读写（inspect / ipqc / fai 三 scope 通用）
// 设计原则：
//   · freq_type IS NULL ⇒ 继承模板级（点检）/ 默认每日（IPQC）→ 零副作用
//   · 只做 zh/vi 双语
// ============================================================
import { one, many, query, transaction } from '../db/index.js';

// ============================================================
// 一、频率工具
// ============================================================

/** 频率类型 → 天数（与 modules-service.freqToDays 口径一致） */
export function freqToDays(freqType, freqInterval) {
  const n = Math.max(1, Number(freqInterval) || 1);
  switch (freqType) {
    case 'day': return n;
    case 'week': return n * 7;
    case 'month': return n * 30;
    case 'quarter': return n * 90;
    case 'year': return n * 365;
    default: return null;
  }
}

export const FREQ_TYPES = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * 计算某检查项的下次到期日。
 * 语义（第 38 轮定稿）：
 *   · 有 last_checked_at（曾经检查过）⇒ 下次到期 = 最近检查日 + 周期天数
 *   · 无 last_checked_at（从未检查过）⇒ 视为「立即到期」（返回基准当日本身），
 *     这样新建/启用的检查项当天即可纳入本批任务，而不是要等到「今天 + 周期」。
 * @param {{freq_type?:string, freq_interval?:number, last_checked_at?:string|Date, created_at?:string|Date}} item
 * @param {string} fallbackFreqType  项未设频率时的继承频率（点检=模板级；IPQC=每日 'day'）
 * @param {number} fallbackInterval
 * @param {string} defaultBaseDate   无 last_checked_at 且无 created_at 时的基准（通常=今天）
 * @returns {string|null} YYYY-MM-DD 或 null（无法派生）
 */
export function deriveNextDue(item, fallbackFreqType, fallbackInterval, defaultBaseDate) {
  const effType = item.freq_type || fallbackFreqType;
  const effInterval = item.freq_type
    ? (item.freq_interval ?? 1)
    : (fallbackInterval ?? item.freq_interval ?? 1);
  const days = freqToDays(effType, effInterval);
  if (!days) return null;

  // 从未检查过 ⇒ 立即到期（基准当日本身）
  if (!item.last_checked_at) {
    const b = item.created_at || defaultBaseDate;
    return b ? String(b).slice(0, 10) : null;
  }
  const base = String(item.last_checked_at).slice(0, 10);
  const next = new Date(`${base}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * 从检查项集合中筛出「基准日 ≤ today」的到期项。
 * @param {Array} items 含 freq_type/freq_interval/last_checked_at/created_at
 * @param {{fallbackFreqType:string, fallbackInterval:number, today:string}} opts
 * @returns {Array} 到期项子集
 */
export function pickDueItems(items, { fallbackFreqType, fallbackInterval, today } = {}) {
  const due = [];
  for (const it of items || []) {
    const nextDue = deriveNextDue(it, fallbackFreqType, fallbackInterval, today);
    if (nextDue && nextDue <= today) due.push(it);
  }
  return due;
}

// ============================================================
// 二、自定义字段定义
// ============================================================

// 作用域：
//   模板头部字段（第 38/39 轮）：inspect / ipqc / fai
//   检查小项字段（第 40 轮）：inspect_item / ipqc_item / fai_item
const SCOPES = ['inspect', 'ipqc', 'fai', 'inspect_item', 'ipqc_item', 'fai_item'];
/** 小项作用域 → 其父（模板）作用域，用于值表/模板表路由 */
const ITEM_SCOPES = { inspect_item: 'inspect', ipqc_item: 'ipqc', fai_item: 'fai' };
/** 模板头作用域集合 */
const HEAD_SCOPES = ['inspect', 'ipqc', 'fai'];
const FIELD_TYPES = ['text', 'number', 'date', 'select'];

function assertScope(scope) {
  if (!SCOPES.includes(scope)) {
    throw Object.assign(new Error(`作用域非法：${scope}（应为 ${SCOPES.join('/')}）`), { statusCode: 400 });
  }
}
/** 是否为小项作用域 */
function isItemScope(scope) { return !!ITEM_SCOPES[scope]; }

function normDef(d = {}) {
  return {
    scope: d.scope,
    field_key: d.fieldKey || d.field_key,
    label_zh: d.labelZh || d.label_zh,
    label_vi: d.labelVi || d.label_vi || null,
    field_type: d.fieldType || d.field_type || 'text',
    options_json: d.options ?? d.options_json ?? null,
    required: d.required === true,
    sort_order: Number(d.sortOrder ?? d.sort_order ?? 0) || 0,
    active: d.active !== false,
  };
}

/** 列出字段定义（可按 scope + active 过滤） */
export async function listTemplateFields({ scope, active } = {}) {
  const params = [];
  let where = '1=1';
  if (scope) { assertScope(scope); params.push(scope); where += ` AND scope = $${params.length}`; }
  if (active !== undefined && active !== null && active !== '') {
    params.push(active === true || active === 'true');
    where += ` AND active = $${params.length}`;
  }
  return many(
    `SELECT * FROM template_custom_field WHERE ${where} ORDER BY scope, sort_order, id`,
    params
  );
}

/** 列出某 scope 的「内置字段」配置（含停用，供模板编辑器决定显示哪些内置字段及标签） */
export async function listBuiltinFields(scope) {
  assertScope(scope);
  return many(
    `SELECT field_key, label_zh, label_vi, active, sort_order
       FROM template_custom_field
      WHERE scope = $1 AND builtin = TRUE
      ORDER BY sort_order, id`,
    [scope]
  );
}

export async function getTemplateField(id) {
  const row = await one(`SELECT * FROM template_custom_field WHERE id = $1`, [id]);
  if (!row) throw Object.assign(new Error('自定义字段不存在'), { statusCode: 404 });
  return row;
}

export async function createTemplateField(data = {}) {
  assertScope(data.scope);
  const d = normDef(data);
  if (!d.field_key) throw Object.assign(new Error('字段键（fieldKey）必填'), { statusCode: 400 });
  if (!d.label_zh) throw Object.assign(new Error('中文字段标签必填'), { statusCode: 400 });
  if (!FIELD_TYPES.includes(d.field_type)) {
    throw Object.assign(new Error(`字段类型非法：${d.field_type}`), { statusCode: 400 });
  }
  const dup = await one(
    `SELECT id, builtin FROM template_custom_field WHERE scope = $1 AND field_key = $2`,
    [d.scope, d.field_key]
  );
  if (dup) {
    if (dup.builtin) {
      throw Object.assign(
        new Error(`「${d.field_key}」是内置字段，不可新建；如需改名/停用请在列表中编辑它`),
        { statusCode: 400, builtin: true }
      );
    }
    throw Object.assign(new Error(`该作用域下字段键已存在：${d.field_key}`), { statusCode: 400 });
  }
  return one(
    `INSERT INTO template_custom_field
       (scope, field_key, label_zh, label_vi, field_type, options_json, required, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [d.scope, d.field_key, d.label_zh, d.label_vi, d.field_type,
     d.options_json ? JSON.stringify(d.options_json) : null,
     d.required, d.sort_order, d.active]
  );
}

export async function updateTemplateField(id, data = {}) {
  const cur = await getTemplateField(id);
  const d = normDef({ ...cur, ...data });
  d.scope = cur.scope;                       // scope 不可改
  d.field_key = data.fieldKey || data.field_key || cur.field_key; // 允许改键（同 scope 内需唯一）
  // 内置字段（第 39/40 轮）：key / 类型 / 必填锁定，只允许改标签 / 启停 / 排序。
  // ⚠️ 必须显式拒绝而非静默忽略：若静默改回原值，调用方会收到「已保存」但改动被丢弃
  // （前端/第三方会误以为生效），属静默数据丢失。故对「显式传入且与现值不同」的锁定字段报 400。
  if (cur.builtin) {
    if (data.fieldKey !== undefined && data.fieldKey !== null
        && String(data.fieldKey) !== String(cur.field_key)) {
      throw Object.assign(
        new Error('内置字段的「字段键」不可修改；如需换名请改「显示名称」'),
        { statusCode: 400, builtin: true, locked: 'fieldKey' }
      );
    }
    if (data.fieldType !== undefined && data.fieldType !== null
        && String(data.fieldType) !== String(cur.field_type)) {
      throw Object.assign(
        new Error('内置字段的「类型」不可修改；如需换类型请新建自定义字段'),
        { statusCode: 400, builtin: true, locked: 'fieldType' }
      );
    }
    if (data.required !== undefined && data.required !== null
        && Boolean(data.required) !== Boolean(cur.required)) {
      throw Object.assign(
        new Error('内置字段的「必填」不可修改'),
        { statusCode: 400, builtin: true, locked: 'required' }
      );
    }
    d.field_key = cur.field_key;
    d.field_type = cur.field_type;
    d.required = cur.required;
  }
  if (!FIELD_TYPES.includes(d.field_type)) {
    throw Object.assign(new Error(`字段类型非法：${d.field_type}`), { statusCode: 400 });
  }
  if (d.field_key !== cur.field_key) {
    const dup = await one(
      `SELECT id FROM template_custom_field WHERE scope = $1 AND field_key = $2 AND id <> $3`,
      [d.scope, d.field_key, id]
    );
    if (dup) throw Object.assign(new Error(`该作用域下字段键已存在：${d.field_key}`), { statusCode: 400 });
  }
  return one(
    `UPDATE template_custom_field
        SET field_key=$2, label_zh=$3, label_vi=$4, field_type=$5, options_json=$6,
            required=$7, sort_order=$8, active=$9, updated_at=now()
      WHERE id=$1 RETURNING *`,
    [id, d.field_key, d.label_zh, d.label_vi, d.field_type,
     d.options_json ? JSON.stringify(d.options_json) : null,
     d.required, d.sort_order, d.active]
  );
}

/**
 * 删除字段定义。
 * 业务裁定：字段已被模板填值引用时不物理删除（避免误删历史配置），返回 400 提示先清值。
 * 若确需删除，调用方应传 force=true 强制级联（值表 ON DELETE CASCADE 会自动清值）。
 */
export async function deleteTemplateField(id, { force = false } = {}) {
  const cur = await getTemplateField(id);
  // 内置字段不允许删除（它对应模板/小项表的既有业务列），只可停用（active=false）
  if (cur.builtin) {
    throw Object.assign(
      new Error('内置字段对应模板既有列，不能删除；如需隐藏请将其「停用」'),
      { statusCode: 400, builtin: true }
    );
  }
  // 小项作用域无值表（其值由小项表自身列承载），自定义小项字段本轮亦不落值表 ⇒ 直接删
  const table = VALUE_TABLES[cur.scope];
  if (table) {
    const cnt = await one(`SELECT COUNT(*)::int AS n FROM ${table} WHERE field_id = $1`, [id]);
    if (Number(cnt?.n) > 0 && !force) {
      throw Object.assign(
        new Error(`该字段已被 ${cnt.n} 个模板填值引用，请先清除引用或使用强制删除`),
        { statusCode: 400, refCount: Number(cnt.n) }
      );
    }
  }
  await query(`DELETE FROM template_custom_field WHERE id = $1`, [id]);
  return { deleted: true };
}

const VALUE_TABLES = {
  inspect: 'inspect_template_field_value',
  ipqc: 'ipqc_template_field_value',
  fai: 'fai_template_field_value',
};

// ============================================================
// 三、模板自定义字段值
// ============================================================

const TEMPLATE_TABLES = {
  inspect: 'equipment_inspect_template',
  ipqc: 'ipqc_template',
  fai: 'fai_template',
};

/**
 * 读取某模板的全部自定义字段值（含未填的启用字段占位）。
 * 仅适用于「模板头作用域」（inspect/ipqc/fai）；小项作用域无值表，返回空数组。
 * @returns {Promise<Array<{fieldId, fieldKey, labelZh, labelVi, fieldType, required, value}>>}
 */
export async function getTemplateFieldValues(scope, templateId) {
  assertScope(scope);
  const table = VALUE_TABLES[scope];
  if (!table) return [];   // 小项作用域无值表（值由小项表自身列承载）
  // 内置字段没有「值」（其值就是模板表自身列），仅返回真正的自定义字段
  const fields = (await listTemplateFields({ scope, active: true })).filter(f => !f.builtin);
  const rows = await many(
    `SELECT field_id, value FROM ${table} WHERE template_id = $1`, [templateId]
  );
  const valMap = new Map(rows.map(r => [String(r.field_id), r.value]));
  return fields.map(f => ({
    fieldId: Number(f.id),
    fieldKey: f.field_key,
    labelZh: f.label_zh,
    labelVi: f.label_vi,
    fieldType: f.field_type,
    options: f.options_json,
    required: f.required,
    value: valMap.has(String(f.id)) ? valMap.get(String(f.id)) : null,
  }));
}

/**
 * 写入模板自定义字段值（整体替换：传 customFields 即覆盖）。
 * @param {object} client 事务 client（可选，不传则自建）
 * @param {string} scope
 * @param {number} templateId
 * @param {Array<{fieldKey?:string, fieldId?:number, value:any}>} customFields
 */
export async function saveTemplateFieldValues(client, scope, templateId, customFields) {
  if (!Array.isArray(customFields)) return;   // 未传 ⇒ 不动（零副作用）
  assertScope(scope);
  const table = VALUE_TABLES[scope];
  if (!table) return;   // 小项作用域无值表（值由小项表自身列承载）⇒ 不落库

  // 解析 fieldKey → fieldId（仅自定义字段有值；内置字段由模板表自身列承载）
  const defs = await many(
    `SELECT id, field_key FROM template_custom_field WHERE scope = $1 AND builtin = FALSE`, [scope]
  );
  const keyMap = new Map(defs.map(d => [d.field_key, Number(d.id)]));
  const idSet = new Set(defs.map(d => Number(d.id)));

  // 整体替换：先清后插（仅限本模板）
  await client.query(`DELETE FROM ${table} WHERE template_id = $1`, [templateId]);
  for (const cf of customFields) {
    const fid = cf.fieldId ? Number(cf.fieldId) : keyMap.get(cf.fieldKey);
    if (!fid || !idSet.has(fid)) continue;   // 忽略未知字段（安全）
    if (cf.value === undefined || cf.value === null || cf.value === '') continue; // 空值不落库
    await client.query(
      `INSERT INTO ${table} (template_id, field_id, value) VALUES ($1,$2,$3)
       ON CONFLICT (template_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
      [templateId, fid, String(cf.value)]
    );
  }
}

/** 包装：在事务内保存（供 create 使用） */
export async function saveTemplateFieldValuesTxn(scope, templateId, customFields) {
  if (!Array.isArray(customFields)) return;
  await transaction(async client => saveTemplateFieldValues(client, scope, templateId, customFields));
}

export { SCOPES, FIELD_TYPES, VALUE_TABLES, TEMPLATE_TABLES, ITEM_SCOPES, HEAD_SCOPES };

/** 内置字段的 field_key ←→ 表列名 映射（供文档/前端校验用） */
export const BUILTIN_KEYS = {
  // 模板头作用域
  inspect: ['equipment_id', 'freq_type', 'freq_interval'],
  ipqc: ['line', 'shift'],
  fai: ['product_code', 'process'],
  // 小项作用域（= 三张小项表真实列名）
  inspect_item: ['item_name', 'item_name_vi', 'standard', 'standard_vi', 'method', 'method_vi',
    'value_type', 'unit', 'min_value', 'max_value', 'freq_type', 'freq_interval'],
  ipqc_item: ['item_name', 'item_name_vi', 'standard', 'standard_vi', 'method', 'method_vi',
    'value_type', 'unit', 'min_value', 'max_value', 'freq_type', 'freq_interval'],
  fai_item: ['item_name', 'item_name_vi', 'standard', 'standard_vi', 'method', 'method_vi',
    'value_type', 'unit', 'min_value', 'max_value', 'freq_type', 'freq_interval'],
};
