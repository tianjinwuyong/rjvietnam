// ============================================================
// qc-library-service —— IQC / OQC 检验模板库（spec §3.2.1~§3.2.4）
//
// 职责边界：
//   · 所有 SQL、所有校验都在本文件；路由层只做参数解析 + 权限。
//   · 对外一律 camelCase（前端契约），DB 一律 snake_case，映射在 mapTemplate / mapItem 收口。
//
// 两条容易踩的坑（写在这里防止后人改回去）：
//   1) 模板上的 7 个抽样默认值（packaging_aql / *_level / *_sample_size 等）
//      只是「新建项目时的预填值」，运行期一律以 iqc_template_item 行内值为准。
//      绝不能实现成「项目没有值就回落到模板值」——那会让模板改默认值污染历史检验单。
//   2) 规格列名统一是 spec。历史笔误已被明令废弃（spec §14.1 D-02），不得再出现。
// ============================================================
import { many, one, transaction } from '../db/index.js';

// 工段枚举取值不得增删（spec §3.3.2）；数组下标即排序号，前端按此顺序展示工段
export const SECTIONS = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];
const SECTION_ORDER = new Map(SECTIONS.map((s, i) => [s, i]));

const bizError = (statusCode, msg) => Object.assign(new Error(msg), { statusCode });
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const str = v => (v == null ? null : String(v).trim() || null);
const userId = user => (user?.id ? Number(user.id) : null);

/** 非负整数归一化：空值→null，非法→抛错 */
function intOrNull(v, msg) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) throw bizError(400, msg);
    return v;
  }
  const s = String(v).trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) throw bizError(400, msg);
  return Number(s);
}

/** 工段集合去重 + 过滤非法值 + 按 §3.3.2 排序号升序 */
function normalizeSections(list) {
  if (!Array.isArray(list)) return [];
  const set = new Set(list.map(s => String(s || '').trim()));
  return SECTIONS.filter(s => set.has(s));
}

/** sectionCounts 补齐 5 个键：前端按固定键取值，缺键会拿不到数字 */
function fullSectionCounts(raw) {
  const out = Object.fromEntries(SECTIONS.map(s => [s, 0]));
  for (const [k, v] of Object.entries(raw || {})) {
    if (k in out) out[k] = Number(v) || 0;
  }
  return out;
}

/* ---------------- 映射 ---------------- */

function mapTemplate(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    scope: r.library_scope,
    code: r.template_code,
    name: r.template_name,
    nameVi: r.template_name_vi,
    nameEn: r.template_name_en,
    version: r.version,
    status: r.status,
    description: r.description,
    // 7 个模板级默认值：仅用于新建项目预填，不参与运行期回落
    packagingAql: r.packaging_aql,
    appearanceLevel: r.appearance_level,
    appearanceAql: r.appearance_aql,
    dimensionLevel: r.dimension_level,
    dimensionAql: r.dimension_aql,
    reliabilitySampleSize: r.reliability_sample_size,
    environmentalSampleSize: r.environmental_sample_size,
    selectedSections: normalizeSections(r.selected_sections || []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapItem(r) {
  const out = {
    id: Number(r.id),
    sectionType: r.section_type,
    itemName: r.item_name,
    itemNameVi: r.item_name_vi,
    itemNameEn: r.item_name_en,
    standard: r.standard,
    spec: r.spec,
    lsl: r.lsl,
    usl: r.usl,
    unit: r.unit,
    aql: r.aql,
    // 轻缺陷 AQL：只在外观段有意义，为空表示该项不区分重/轻
    aqlMinor: r.aql_minor,
    samplingPlanText: r.sampling_plan_text,
    sampleSize: r.sample_size,
    ac: r.ac,
    re: r.re,
    sortOrder: r.sort_order,
    isRequired: r.is_required,
  };
  if ('active' in r) out.active = r.active; // 标准项目库专有
  return out;
}

/** 统一排序：工段序号 → sort_order → id */
const sortItems = rows => rows
  .map(mapItem)
  .sort((a, b) => (SECTION_ORDER.get(a.sectionType) ?? 99) - (SECTION_ORDER.get(b.sectionType) ?? 99)
    || a.sortOrder - b.sortOrder
    || a.id - b.id);

/* ---------------- 模板字段表 ---------------- */

const TEMPLATE_FIELDS = {
  scope: 'library_scope',
  code: 'template_code',
  name: 'template_name',
  nameVi: 'template_name_vi',
  nameEn: 'template_name_en',
  version: 'version',
  status: 'status',
  description: 'description',
  packagingAql: 'packaging_aql',
  appearanceLevel: 'appearance_level',
  appearanceAql: 'appearance_aql',
  dimensionLevel: 'dimension_level',
  dimensionAql: 'dimension_aql',
  reliabilitySampleSize: 'reliability_sample_size',
  environmentalSampleSize: 'environmental_sample_size',
  selectedSections: 'selected_sections',
};

const isSampleSizeField = key => key === 'reliabilitySampleSize' || key === 'environmentalSampleSize';

function normalizeScope(v) {
  const s = v == null || String(v).trim() === '' ? 'iqc' : String(v).trim();
  if (!['iqc', 'oqc'].includes(s)) throw bizError(400, '库归属只能是 iqc 或 oqc');
  return s;
}

function normalizeStatus(v) {
  const s = v == null || String(v).trim() === '' ? 'active' : String(v).trim();
  if (!['active', 'inactive'].includes(s)) throw bizError(400, '状态只能是 active 或 inactive');
  return s;
}

function normalizeTemplateValue(key, value) {
  switch (key) {
    case 'scope': return normalizeScope(value);
    case 'status': return normalizeStatus(value);
    case 'selectedSections': return normalizeSections(value);
    default:
      return isSampleSizeField(key) ? intOrNull(value, '抽样数必须是非负整数') : str(value);
  }
}

/** 同库模板编码唯一由服务端先查后报：DB 唯一索引抛的 23505 会被统一脱敏成通用文案 */
async function assertCodeFree(scope, code, excludeId = null) {
  if (!code) return;
  const row = await one(
    `SELECT id FROM iqc_template WHERE library_scope=$1 AND template_code=$2 AND ($3::bigint IS NULL OR id <> $3)`,
    [scope, code, excludeId]
  );
  if (row) throw bizError(409, `模板编码「${code}」在该库中已存在`);
}

async function requireTemplate(id) {
  const row = await one('SELECT * FROM iqc_template WHERE id=$1', [id]);
  if (!row) throw bizError(404, '模板不存在');
  return row;
}

/* ---------------- 模板 CRUD ---------------- */

export async function listTemplates(params = {}) {
  const where = [];
  const args = [];
  if (params.scope && ['iqc', 'oqc'].includes(params.scope)) {
    args.push(params.scope);
    where.push(`t.library_scope = $${args.length}`);
  }
  // status=all 返回全量；否则只认 active/inactive，缺省 active（列表默认不展示停用模板）
  if (params.status !== 'all') {
    args.push(params.status === 'inactive' ? 'inactive' : 'active');
    where.push(`t.status = $${args.length}`);
  }
  const kw = str(params.keyword);
  if (kw) {
    args.push(`%${kw}%`);
    where.push(`(t.template_name ILIKE $${args.length} OR COALESCE(t.template_code,'') ILIKE $${args.length})`);
  }
  // 一次 GROUP BY 出 itemCount + sectionCounts，避免按模板逐条查（N+1）
  const rows = await many(
    `SELECT t.*, COALESCE(agg.item_count, 0) AS item_count, agg.section_counts
       FROM iqc_template t
       LEFT JOIN (
         SELECT template_id, SUM(cnt) AS item_count, jsonb_object_agg(section_type, cnt) AS section_counts
           FROM (SELECT template_id, section_type, COUNT(*) AS cnt
                   FROM iqc_template_item GROUP BY template_id, section_type) s
          GROUP BY template_id
       ) agg ON agg.template_id = t.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.updated_at DESC, t.id DESC`,
    args
  );
  return rows.map(r => ({
    ...mapTemplate(r),
    itemCount: Number(r.item_count) || 0,
    sectionCounts: fullSectionCounts(r.section_counts),
  }));
}

export async function getTemplate(id) {
  const row = await requireTemplate(id);
  const items = sortItems(await many('SELECT * FROM iqc_template_item WHERE template_id=$1', [id]));
  const mats = await many('SELECT material_code FROM iqc_template_material WHERE template_id=$1 ORDER BY id', [id]);
  return { ...mapTemplate(row), items, materials: mats.map(m => m.material_code) };
}

export async function createTemplate(body = {}, user = null) {
  const name = str(body.name);
  if (!name) throw bizError(400, '模板名称不能为空');
  if (name.length > 200) throw bizError(400, '模板名称超长（≤200）');

  const pairs = [['created_by', userId(user)], ['updated_by', userId(user)]];
  for (const [key, col] of Object.entries(TEMPLATE_FIELDS)) {
    if (!has(body, key)) continue;
    const v = normalizeTemplateValue(key, body[key]);
    if (v === undefined) continue;
    pairs.push([col, v]);
  }
  const scope = pairs.find(([c]) => c === 'library_scope')?.[1] || 'iqc';
  const code = pairs.find(([c]) => c === 'template_code')?.[1] || null;
  await assertCodeFree(scope, code);

  const row = await one(
    `INSERT INTO iqc_template (${pairs.map(([c]) => c).join(',')})
     VALUES (${pairs.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    pairs.map(([, v]) => v)
  );
  return { ...mapTemplate(row), items: [], materials: [] };
}

export async function updateTemplate(id, body = {}, user = null) {
  await requireTemplate(id);

  // 用「字段是否出现」判断，而不是 COALESCE：
  // 前者能区分「不改」与「清空」，后者会把 null 当成「保持原值」，导致值永远清不掉
  const sets = [];
  const args = [];
  for (const [key, col] of Object.entries(TEMPLATE_FIELDS)) {
    if (!has(body, key)) continue;
    const raw = body[key];
    if (raw === null && (key === 'scope' || key === 'status' || key === 'version')) continue; // NOT NULL 列不允许清空
    if (key === 'name') {
      const name = str(raw);
      if (!name) throw bizError(400, '模板名称不能为空');
      if (name.length > 200) throw bizError(400, '模板名称超长（≤200）');
    }
    args.push(normalizeTemplateValue(key, raw));
    sets.push(`${col} = $${args.length}`);
  }

  // code 改动同样先查重（排除自身）
  if (has(body, 'code') && body.code != null) {
    const scope = has(body, 'scope') && body.scope ? normalizeScope(body.scope) : undefined;
    const cur = await one('SELECT library_scope FROM iqc_template WHERE id=$1', [id]);
    await assertCodeFree(scope || cur.library_scope, normalizeTemplateValue('code', body.code), id);
  }

  if (sets.length) {
    args.push(userId(user));
    sets.push(`updated_by = $${args.length}`);
  }
  args.push(id);
  // updated_at 恒刷新：即使本次无字段变化，也要让列表的「最近修改」反映这次操作
  const row = await one(
    `UPDATE iqc_template SET ${sets.length ? `${sets.join(', ')}, ` : ''}updated_at = now()
      WHERE id = $${args.length} RETURNING *`,
    args
  );
  if (!row) throw bizError(404, '模板不存在');
  return getTemplate(Number(row.id));
}

export async function deleteTemplate(id) {
  await requireTemplate(id);
  // 项目行与物料绑定由 FK ON DELETE CASCADE 带走，不手写子表删除
  await one('DELETE FROM iqc_template WHERE id=$1 RETURNING id', [id]);
  return { id: Number(id) };
}

export async function duplicateTemplate(id, body = {}, user = null) {
  const src = await requireTemplate(id);
  const scope = normalizeScope(has(body, 'scope') && body.scope ? body.scope : src.library_scope);
  const code = has(body, 'code') && body.code != null
    ? str(body.code)
    : (src.template_code ? `${src.template_code}-副本` : null);
  const name = has(body, 'name') && str(body.name)
    ? str(body.name)
    : `${src.template_name}-副本`;
  await assertCodeFree(scope, code);

  const newId = await transaction(async client => {
    const ins = await client.query(
      `INSERT INTO iqc_template
         (library_scope, template_code, template_name, template_name_vi, template_name_en,
          version, status, description,
          packaging_aql, appearance_level, appearance_aql, dimension_level, dimension_aql,
          reliability_sample_size, environmental_sample_size, selected_sections, created_by, updated_by)
       SELECT $1, $2, $3, template_name_vi, template_name_en,
              version, status, description,
              packaging_aql, appearance_level, appearance_aql, dimension_level, dimension_aql,
              reliability_sample_size, environmental_sample_size, selected_sections, $4, $4
         FROM iqc_template WHERE id=$5 RETURNING id`,
      [scope, code, name, userId(user), id]
    );
    const created = ins.rows[0].id;
    // 项目行整批复制：一条 INSERT ... SELECT，避免逐行往返
    await client.query(
      `INSERT INTO iqc_template_item
         (template_id, section_type, item_name, item_name_vi, item_name_en, standard, spec,
          lsl, usl, unit, aql, aql_minor, sampling_plan_text, sample_size, ac, re, sort_order, is_required)
       SELECT $1, section_type, item_name, item_name_vi, item_name_en, standard, spec,
              lsl, usl, unit, aql, aql_minor, sampling_plan_text, sample_size, ac, re, sort_order, is_required
         FROM iqc_template_item WHERE template_id=$2`,
      [created, id]
    );
    return Number(created);
  });
  return getTemplate(newId);
}

/* ---------------- 检验项 ---------------- */

async function assertTemplateExists(id) {
  await requireTemplate(id);
}

export async function listTemplateItems(id) {
  await assertTemplateExists(id);
  return sortItems(await many('SELECT * FROM iqc_template_item WHERE template_id=$1', [id]));
}

/**
 * 单行校验（template item / standard item 共用）。
 * idx 为 null 时用于单条维护，文案不带行号。
 */
function validateItemRow(row = {}, idx = null) {
  // 行号前缀统一在这里拼：批量接口文案必须带行号，单条维护接口不带。
  // 前缀后是否留空格由调用方文本决定（英文词如 AQL 前面要空格），所以这里不写死分隔符。
  // 统一分隔符：调用方仍传"：xxx"，这里剥掉冒号后由本函数决定是否加前缀，
  // 否则 idx==null 时会飞出"：检验工段不合法"这种以冒号开头的消息 —— 既难看，
  // 也让后端词库的反查/模板都匹配不上（中文残留的典型来源）。
  const line = (text) => {
    const body = String(text ?? '').replace(/^[：:]\s*/, '');
    return idx == null ? body : `第 ${idx + 1} 行：${body}`;
  };

  const sectionType = String(row.sectionType || '').trim();
  if (!SECTION_ORDER.has(sectionType)) throw bizError(400, line('：检验工段不合法'));

  const itemName = str(row.itemName);
  if (!itemName) throw bizError(400, line('检验项目名称为空'));
  if (itemName.length > 300) throw bizError(400, line('检验项目名称超长（≤300）'));

  const spec = str(row.spec);
  if (spec && spec.length > 50) throw bizError(400, line('规格超长（≤50）'));

  // D-10：AQL / AC / RE 只由服务端校验后落库，不信任前端传值
  const aql = str(row.aql);
  if (aql && !/^\d+(\.\d+)?$/.test(aql)) throw bizError(400, line(' AQL 格式不合法'));

  // 外观的重/轻缺陷各一个 AQL；只有外观段允许填轻缺陷 AQL
  const aqlMinor = str(row.aqlMinor);
  if (aqlMinor && !/^\d+(\.\d+)?$/.test(aqlMinor)) throw bizError(400, line(' 轻缺陷 AQL 格式不合法'));
  if (aqlMinor && sectionType !== 'appearance') throw bizError(400, line('：只有外观段可以设置轻缺陷 AQL'));

  const sizeMsg = line('抽样数/AC/RE 必须是非负整数');
  return {
    sectionType,
    itemName,
    itemNameVi: str(row.itemNameVi),
    itemNameEn: str(row.itemNameEn),
    standard: str(row.standard),
    spec,
    lsl: str(row.lsl),
    usl: str(row.usl),
    unit: str(row.unit),
    aql,
    aqlMinor,
    samplingPlanText: str(row.samplingPlanText),
    sampleSize: intOrNull(row.sampleSize, sizeMsg),
    ac: intOrNull(row.ac, sizeMsg),
    re: intOrNull(row.re, sizeMsg),
    sortOrder: row.sortOrder == null || row.sortOrder === '' ? idx ?? 0 : Number(row.sortOrder) || 0,
    isRequired: row.isRequired == null ? true : !!row.isRequired,
  };
}

function validateItems(items) {
  if (!Array.isArray(items)) throw bizError(400, 'items 必须是数组');
  const rows = items.map((it, i) => validateItemRow(it || {}, i));
  // 同工段重名检查：模板内同工段同名会让检验录入出现两条无法区分的项
  const seen = new Map();
  rows.forEach((r, i) => {
    const key = `${r.sectionType}\u0000${r.itemName}`;
    if (seen.has(key)) throw bizError(400, `第 ${i + 1} 行「${r.itemName}」在同一工段内重名`);
    seen.set(key, true);
  });
  return rows;
}

const ITEM_COLS = ['section_type', 'item_name', 'item_name_vi', 'item_name_en', 'standard', 'spec',
  'lsl', 'usl', 'unit', 'aql', 'aql_minor', 'sampling_plan_text', 'sample_size', 'ac', 're', 'sort_order', 'is_required'];

const itemValues = r => [r.sectionType, r.itemName, r.itemNameVi, r.itemNameEn, r.standard, r.spec,
  r.lsl, r.usl, r.unit, r.aql, r.aqlMinor || null, r.samplingPlanText, r.sampleSize, r.ac, r.re, r.sortOrder, r.isRequired];

export async function replaceTemplateItems(templateId, items, user = null) {
  const rows = validateItems(items);
  await transaction(async client => {
    // 锁住模板行：整模板替换是「全删再插」，两个并发保存不串行会互相吞掉对方的行
    const t = await client.query('SELECT id FROM iqc_template WHERE id=$1 FOR UPDATE', [templateId]);
    if (!t.rowCount) throw bizError(404, '模板不存在');

    await client.query('DELETE FROM iqc_template_item WHERE template_id=$1', [templateId]);
    const cols = ['template_id', ...ITEM_COLS];
    const sql = `INSERT INTO iqc_template_item (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`;
    for (const r of rows) {
      await client.query(sql, [templateId, ...itemValues(r)]);
    }
    // selected_sections 跟着项目行实际内容走，避免前端传的工段集合与实际数据不一致
    const sections = normalizeSections(rows.map(r => r.sectionType));
    await client.query(
      'UPDATE iqc_template SET selected_sections=$2, updated_by=$3, updated_at=now() WHERE id=$1',
      [templateId, sections, userId(user)]
    );
  });
  return listTemplateItems(templateId);
}

export async function importSection(templateId, sectionType, user = null) {
  const section = String(sectionType || '').trim();
  if (!SECTION_ORDER.has(section)) throw bizError(400, '检验工段不合法');

  const count = await transaction(async client => {
    const t = await client.query('SELECT selected_sections FROM iqc_template WHERE id=$1 FOR UPDATE', [templateId]);
    if (!t.rowCount) throw bizError(404, '模板不存在');

    // 幂等：先清掉该工段旧行，再把标准库该工段全量导入，重复调用结果一致
    await client.query('DELETE FROM iqc_template_item WHERE template_id=$1 AND section_type=$2', [templateId, section]);
    const ins = await client.query(
      `INSERT INTO iqc_template_item (template_id, ${ITEM_COLS.join(',')})
       SELECT $1, ${ITEM_COLS.join(',')} FROM iqc_standard_item
        WHERE section_type=$2 AND active=TRUE
        ORDER BY sort_order, id`,
      [templateId, section]
    );
    const sections = normalizeSections([...(t.rows[0].selected_sections || []), section]);
    await client.query(
      'UPDATE iqc_template SET selected_sections=$2, updated_by=$3, updated_at=now() WHERE id=$1',
      [templateId, sections, userId(user)]
    );
    return ins.rowCount;
  });
  return { count };
}

/* ---------------- 标准项目库 ---------------- */

export async function listStandardItems(params = {}) {
  const where = [];
  const args = [];
  const section = str(params.sectionType);
  if (section && SECTION_ORDER.has(section)) {
    args.push(section);
    where.push(`section_type = $${args.length}`);
  }
  const kw = str(params.keyword);
  if (kw) {
    args.push(`%${kw}%`);
    where.push(`item_name ILIKE $${args.length}`);
  }
  const rows = await many(
    `SELECT * FROM iqc_standard_item ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    args
  );
  return sortItems(rows);
}

async function assertStandardNameFree(sectionType, itemName, excludeId = null) {
  const row = await one(
    `SELECT id FROM iqc_standard_item
      WHERE section_type=$1 AND item_name=$2 AND ($3::bigint IS NULL OR id <> $3)`,
    [sectionType, itemName, excludeId]
  );
  if (row) throw bizError(409, `该工段已有同名项目「${itemName}」`);
}

export async function createStandardItem(body = {}, user = null) {
  const r = validateItemRow(body, null);
  await assertStandardNameFree(r.sectionType, r.itemName);
  const row = await one(
    `INSERT INTO iqc_standard_item (${ITEM_COLS.join(',')}, active, created_by)
     VALUES (${ITEM_COLS.map((_, i) => `$${i + 1}`).join(',')}, $${ITEM_COLS.length + 1}, $${ITEM_COLS.length + 2})
     RETURNING *`,
    [...itemValues(r), body.active == null ? true : !!body.active, userId(user)]
  );
  return mapItem(row);
}

export async function updateStandardItem(id, body = {}, user = null) {
  const cur = await one('SELECT * FROM iqc_standard_item WHERE id=$1', [id]);
  if (!cur) throw bizError(404, '标准项目不存在');

  // 合并现值后整体校验：PUT 允许只传部分字段
  const merged = {
    sectionType: has(body, 'sectionType') ? body.sectionType : cur.section_type,
    itemName: has(body, 'itemName') ? body.itemName : cur.item_name,
    itemNameVi: has(body, 'itemNameVi') ? body.itemNameVi : cur.item_name_vi,
    itemNameEn: has(body, 'itemNameEn') ? body.itemNameEn : cur.item_name_en,
    standard: has(body, 'standard') ? body.standard : cur.standard,
    spec: has(body, 'spec') ? body.spec : cur.spec,
    lsl: has(body, 'lsl') ? body.lsl : cur.lsl,
    usl: has(body, 'usl') ? body.usl : cur.usl,
    unit: has(body, 'unit') ? body.unit : cur.unit,
    aql: has(body, 'aql') ? body.aql : cur.aql,
    aqlMinor: has(body, 'aqlMinor') ? body.aqlMinor : cur.aql_minor,
    samplingPlanText: has(body, 'samplingPlanText') ? body.samplingPlanText : cur.sampling_plan_text,
    sampleSize: has(body, 'sampleSize') ? body.sampleSize : cur.sample_size,
    ac: has(body, 'ac') ? body.ac : cur.ac,
    re: has(body, 're') ? body.re : cur.re,
    sortOrder: has(body, 'sortOrder') ? body.sortOrder : cur.sort_order,
    isRequired: has(body, 'isRequired') ? body.isRequired : cur.is_required,
  };
  const r = validateItemRow(merged, null);
  await assertStandardNameFree(r.sectionType, r.itemName, Number(id));

  const row = await one(
    `UPDATE iqc_standard_item
        SET ${ITEM_COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')},
            active = $${ITEM_COLS.length + 1}, updated_at = now()
      WHERE id = $${ITEM_COLS.length + 2} RETURNING *`,
    [...itemValues(r), has(body, 'active') ? !!body.active : cur.active, id]
  );
  return mapItem(row);
}

export async function deleteStandardItem(id) {
  const row = await one('DELETE FROM iqc_standard_item WHERE id=$1 RETURNING id', [id]);
  if (!row) throw bizError(404, '标准项目不存在');
  return { ok: true, id: Number(id) };
}

export async function bulkUpsertStandardItems(items, user = null) {
  const rows = validateItems(items);
  let inserted = 0;
  let updated = 0;
  await transaction(async client => {
    for (const r of rows) {
      // 以 (sectionType, itemName) 为业务主键 upsert：批量导入常含重复投喂，靠它保持幂等
      const up = await client.query(
        `UPDATE iqc_standard_item
            SET ${ITEM_COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
          WHERE section_type = $${ITEM_COLS.length + 1} AND item_name = $${ITEM_COLS.length + 2}
          RETURNING id`,
        [...itemValues(r), r.sectionType, r.itemName]
      );
      if (up.rowCount) {
        updated += 1;
        continue;
      }
      await client.query(
        `INSERT INTO iqc_standard_item (${ITEM_COLS.join(',')}, created_by)
         VALUES (${ITEM_COLS.map((_, i) => `$${i + 1}`).join(',')}, $${ITEM_COLS.length + 1})`,
        [...itemValues(r), userId(user)]
      );
      inserted += 1;
    }
  });
  return { inserted, updated };
}

/**
 * 整页保存标准项目库（对齐 WMS「IQC 标准库管理」的保存语义）。
 *
 * 为什么不是逐行保存：这个弹窗是"整段编辑、一次落库"的用法，逐行点保存等于强迫用户
 * 点几十次，而且中途漏点会造成"看起来填了其实没存"。WMS 就是一个顶部「保存」按钮遍历全部行。
 *
 * 与 WMS 的三点差异（都是修正它的缺陷，不影响对外行为）：
 *   1) WMS 逐条 await，中途失败会留下"存了一半"的库；这里放进一个事务，失败整体回滚。
 *   2) 项目名留空的行按 WMS 口径**跳过不报错**（那是没填完的草稿行），但要计数返回。
 *   3) 段内 sortOrder 按提交顺序重排为 1..n，保证"界面上第几行就是库里第几"。
 */
export async function saveAllStandardItems(items, user = null) {
  if (!Array.isArray(items)) throw bizError(400, 'items 必须是数组');

  // 先按 WMS 口径丢掉空名行，再校验：否则用户留一行空行就整页存不了
  // 注意不能写成 str(itemName) !== ''：str() 对空值是返回 null 的，null !== '' 恒真，空行会混进去
  const kept = items
    .map(it => ({ id: it?.id ?? null, row: it || {} }))
    .filter(p => String(p.row.itemName ?? '').trim() !== '');
  const skipped = items.length - kept.length;

  const rows = validateItems(kept.map(p => p.row));

  // 段内顺序即提交顺序；跨段互不影响
  const seq = new Map();
  for (const r of rows) {
    const n = (seq.get(r.sectionType) || 0) + 1;
    seq.set(r.sectionType, n);
    r.sortOrder = n;
  }

  let inserted = 0;
  let updated = 0;
  await transaction(async client => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rawId = Number(kept[i].id);
      const id = Number.isFinite(rawId) && rawId > 0 ? Math.trunc(rawId) : null;
      if (id) {
        const up = await client.query(
          `UPDATE iqc_standard_item
              SET ${ITEM_COLS.map((c, k) => `${c} = $${k + 1}`).join(', ')}, active = $${ITEM_COLS.length + 1},
                  updated_at = now()
            WHERE id = $${ITEM_COLS.length + 2}
            RETURNING id`,
          [...itemValues(r), true, id]
        );
        if (up.rowCount) { updated += 1; continue; }
        // 行在别处被删了：降级为新增，不能让用户白填
      }
      await client.query(
        `INSERT INTO iqc_standard_item (${ITEM_COLS.join(',')}, created_by)
         VALUES (${ITEM_COLS.map((_, k) => `$${k + 1}`).join(',')}, $${ITEM_COLS.length + 1})`,
        [...itemValues(r), userId(user)]
      );
      inserted += 1;
    }
  });
  return { inserted, updated, skipped };
}

/* ---------------- 物料绑定 ---------------- */

export async function listTemplateMaterials(id) {
  await assertTemplateExists(id);
  const rows = await many(
    'SELECT material_code, created_at FROM iqc_template_material WHERE template_id=$1 ORDER BY id',
    [id]
  );
  return rows.map(r => ({ materialCode: r.material_code, createdAt: r.created_at }));
}

export async function addTemplateMaterials(id, materialCodes, user = null) {
  await assertTemplateExists(id);
  if (!Array.isArray(materialCodes)) throw bizError(400, 'materialCodes 必须是数组');
  const codes = [...new Set(materialCodes.map(c => str(c)).filter(Boolean))];
  if (!codes.length) return { added: 0, skipped: 0 };

  const ins = await many(
    `INSERT INTO iqc_template_material (template_id, material_code, created_by)
     SELECT $1, c, $3 FROM unnest($2::varchar[]) AS c
     ON CONFLICT (template_id, material_code) DO NOTHING
     RETURNING material_code`,
    [id, codes, userId(user)]
  );
  return { added: ins.length, skipped: codes.length - ins.length };
}

export async function removeTemplateMaterial(id, materialCode) {
  await assertTemplateExists(id);
  const code = str(materialCode);
  if (!code) throw bizError(400, '参数不合法');
  await one(
    'DELETE FROM iqc_template_material WHERE template_id=$1 AND material_code=$2 RETURNING id',
    [id, code]
  );
  return { ok: true };
}

export async function listTemplatesByMaterial(materialCode, params = {}) {
  const code = str(materialCode);
  if (!code) throw bizError(400, '参数不合法');
  const args = [code];
  let scopeSql = '';
  if (params.scope && ['iqc', 'oqc'].includes(params.scope)) {
    args.push(params.scope);
    scopeSql = `AND t.library_scope = $${args.length}`;
  }
  const rows = await many(
    `SELECT t.*, COALESCE(agg.item_count, 0) AS item_count, agg.section_counts
       FROM iqc_template t
       JOIN iqc_template_material m ON m.template_id = t.id AND m.material_code = $1
       LEFT JOIN (
         SELECT template_id, SUM(cnt) AS item_count, jsonb_object_agg(section_type, cnt) AS section_counts
           FROM (SELECT template_id, section_type, COUNT(*) AS cnt
                   FROM iqc_template_item GROUP BY template_id, section_type) s
          GROUP BY template_id
       ) agg ON agg.template_id = t.id
      WHERE TRUE ${scopeSql}
      ORDER BY t.updated_at DESC, t.id DESC`,
    args
  );
  return rows.map(r => ({
    ...mapTemplate(r),
    itemCount: Number(r.item_count) || 0,
    sectionCounts: fullSectionCounts(r.section_counts),
  }));
}
