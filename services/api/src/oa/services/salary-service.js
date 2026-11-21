// ============================================================
// S5 薪资架构服务
// 职责：
//   · 薪资架构版本化 CRUD（list / get / create / update）+ 审批（draft → approved，旧版 archived）
//   · 职类树 CRUD + 职类分配（批量匹配 / 个别覆盖，salary_assignment 按天解析）
//   · 薪资试算 generateSalary：按天生效结构 + 当月考勤汇总 → salary_record
//   · 薪资记录列表 / 导出（前端生成 xlsx）
// 设计约束：
//   · 版本化：同一员工可有多版本；审批通过后旧版本自动 archived。
//   · 试算取当天生效结构（员工级 > 职类模板）；无结构可用的员工跳过。
//   · 保险：个人缴纳与工会费计入扣款；公司缴纳同口径计算但仅告知，不进 gross/net。
//   · 权限隔离：薪资敏感，接口只允许本人或 salary:manage（在路由层 + service 内校验 userId）。
//   · 后端不解析 xlsx，导出返回 {columns,rows}。
// 中越双语：所有 label 同时提供 label 与 label_vi。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { getWorkCalendar } from './attendance-service.js';

/** 数值化，非法返回 0 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 四舍五入到 2 位小数 */
function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/** 四舍五入到 4 位小数（税率用：0.0500 = 5%） */
function round4(v) {
  return Math.round((Number(v) || 0) * 10000) / 10000;
}

/** 按币种取整：VND 整数、CNY 两位（存储保持 2 位精度，导出层按此取整展示） */
function roundMoney(v, currency) {
  return currency === 'CNY' ? round2(v) : Math.round(num(v));
}

/** 校验 'YYYY-MM' 周期格式 */
function validPeriod(p) {
  return /^\d{4}-\d{2}$/.test(String(p || ''));
}

/** 解析 'YYYY-MM-DD'（与 attendance-service 同口径） */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, da] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/** 当月天数 */
function daysInMonth(period) {
  const [y, m] = String(period).split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// ============================================================
// 一、薪资架构 CRUD（版本化）
// ============================================================

/** 读取某结构的项目行（按 seq 升序） */
async function loadLines(structureId) {
  return many(
    `SELECT id, seq, code, name, name_vi, category, calc_mode, value, config
       FROM salary_structure_line WHERE structure_id = $1 ORDER BY seq`,
    [structureId]
  );
}

const LINE_MODE_BY_CATEGORY = {
  base: ['fixed'],
  perf: ['perf_coef', 'perf_abs'],
  ot: ['ot_auto', 'ot_custom'],
  earning: ['fixed', 'base_ratio'],
  deduction: ['fixed', 'base_ratio'],
  absent: ['absent'],
  late_early: ['late_early'],
  // 保险（个人缴纳 / 公司缴纳）与工会费：固定金额 或 基数比例
  insurance_personal: ['fixed', 'base_ratio'],
  insurance_company: ['fixed', 'base_ratio'],
  union_fee: ['fixed', 'base_ratio'],
};

/** 保险/工会费三类：同一套「基数 × 比例 / 固定额」口径，但只有个人保险与工会费进扣款 */
const INSURANCE_CATS = new Set(['insurance_personal', 'insurance_company', 'union_fee']);

/** 项目行校验：category/calc_mode 组合、base 唯一、seq 唯一、比例/单价边界 */
function validateStructureLines(lines) {
  if (!Array.isArray(lines)) return;
  const seqs = new Set();
  let baseCount = 0;
  for (const [i, ln] of lines.entries()) {
    const row = i + 1;
    if (!ln || !String(ln.code || '').trim() || !String(ln.name || '').trim()) {
      throw Object.assign(new Error(`第 ${row} 行：code/name 必填`), { statusCode: 400 });
    }
    const seq = Number(ln.seq) || (i + 1);
    if (seqs.has(seq)) throw Object.assign(new Error(`第 ${row} 行：seq ${seq} 重复`), { statusCode: 400 });
    seqs.add(seq);
    const category = ln.category || 'earning';
    const mode = ln.calc_mode || 'fixed';
    const allowed = LINE_MODE_BY_CATEGORY[category];
    if (!allowed) throw Object.assign(new Error(`第 ${row} 行：category 非法（${category}）`), { statusCode: 400 });
    if (!allowed.includes(mode)) {
      throw Object.assign(new Error(`第 ${row} 行：${category} 不支持 calc_mode=${mode}`), { statusCode: 400 });
    }
    if (category === 'base') {
      baseCount += 1;
      if (baseCount > 1) throw Object.assign(new Error('仅允许一个 base 底薪行'), { statusCode: 400 });
    }
    const value = Number(ln.value) || 0;
    if (mode === 'base_ratio' && (value < 0 || value > 100)) {
      throw Object.assign(new Error(`第 ${row} 行：比例应在 0~100`), { statusCode: 400 });
    }
    if (category === 'perf' && value <= 0) {
      throw Object.assign(new Error(`第 ${row} 行：绩效基数应大于 0`), { statusCode: 400 });
    }
    if (mode === 'ot_custom') {
      const c = ln.config || {};
      for (const k of ['weekday', 'weekend', 'holiday']) {
        if (!Number.isFinite(Number(c[k])) || Number(c[k]) < 0) {
          throw Object.assign(new Error(`第 ${row} 行：ot_custom 缺少/非法 ${k} 单价`), { statusCode: 400 });
        }
      }
    }
    if (mode === 'late_early') {
      const c = ln.config || {};
      if (!['per_minute', 'per_time'].includes(c.mode)) {
        throw Object.assign(new Error(`第 ${row} 行：late_early.mode 应为 per_minute/per_time`), { statusCode: 400 });
      }
      if (!Number.isFinite(Number(c.rate)) || Number(c.rate) < 0) {
        throw Object.assign(new Error(`第 ${row} 行：late_early.rate 非法`), { statusCode: 400 });
      }
    }
    if (INSURANCE_CATS.has(category)) {
      // 口径：缴费基数（base_field=base 底薪 / gross 应发）按 cap/floor 夹逼后乘比例；
      // 公司保险同一套口径计算，但不计入扣款与应发实发（见 generateSalary）。
      const c = ln.config || {};
      const baseField = c.base_field ?? 'base';
      if (!['base', 'gross'].includes(baseField)) {
        throw Object.assign(new Error(`第 ${row} 行：base_field 应为 base/gross`), { statusCode: 400 });
      }
      for (const k of ['cap', 'floor']) {
        if (c[k] != null && c[k] !== '' && (!Number.isFinite(Number(c[k])) || Number(c[k]) < 0)) {
          throw Object.assign(new Error(`第 ${row} 行：${k} 应为非负数`), { statusCode: 400 });
        }
      }
      const cap = c.cap == null || c.cap === '' ? null : Number(c.cap);
      const floor = c.floor == null || c.floor === '' ? null : Number(c.floor);
      if (cap != null && floor != null && cap < floor) {
        throw Object.assign(new Error(`第 ${row} 行：基数上限不得小于下限`), { statusCode: 400 });
      }
    }
  }
}

/** 写入项目行（整体替换） */
async function saveLines(client, structureId, lines) {
  if (!Array.isArray(lines)) return;
  validateStructureLines(lines);
  for (const [i, ln] of lines.entries()) {
    if (!ln || !ln.code || !ln.name) continue;
    await client.query(
      `INSERT INTO salary_structure_line (structure_id, seq, code, name, name_vi, category, calc_mode, value, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        structureId, Number(ln.seq) || (i + 1), String(ln.code), String(ln.name),
        ln.name_vi || null, ln.category || 'earning', ln.calc_mode || 'fixed',
        Number(ln.value) || 0, JSON.stringify(ln.config || {}),
      ]
    );
  }
}


/**
 * 薪资架构列表（分页契约；未传 page 返回数组）。
 * @param {{userId?:number, status?:string, page?:number, pageSize?:number}} opts
 */
export async function listSalaryStructures({ userId, status, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND s.user_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND s.status = $${params.length}`; }

  const selectSql =
    `SELECT s.*, u.real_name, u.employee_no
       FROM salary_structure s
       LEFT JOIN org_user u ON u.id = s.user_id
      WHERE ${where}
      ORDER BY s.class_id NULLS LAST, s.user_id NULLS LAST, s.version DESC`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM salary_structure s WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 取单个架构（含明细项）。
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getSalaryStructure(id) {
  const s = await one(
    `SELECT s.*, u.real_name, u.employee_no
       FROM salary_structure s LEFT JOIN org_user u ON u.id = s.user_id
      WHERE s.id = $1`,
    [id]
  );
  if (!s) return null;
  const items = await many(
    `SELECT * FROM salary_structure_item WHERE structure_id = $1 ORDER BY item_type, id`, [id]
  );
  const lines = await loadLines(id);
  return { ...s, items, lines };
}

/**
 * 取某员工最新 approved 架构（含明细项）；无则 null。
 * @param {number} userId
 */
export async function getLatestApprovedStructure(userId) {
  const s = await one(
    `SELECT * FROM salary_structure
      WHERE user_id = $1 AND status = 'approved'
      ORDER BY version DESC LIMIT 1`,
    [userId]
  );
  if (!s) return null;
  const items = await many(
    `SELECT * FROM salary_structure_item WHERE structure_id = $1 ORDER BY id`, [s.id]
  );
  const lines = await loadLines(s.id);
  return { ...s, items, lines };
}

/**
 * 新建薪资架构（版本递增）。
 * 新版本初始为 draft；同一员工已有 draft 时版本号继续递增。
 * @param {{userId:number, baseSalary?:number, postAllowance?:number, otRateWeekday?:number,
 *          otRateWeekend?:number, otRateHoliday?:number, effectiveFrom?:string,
 *          items?:Array<{item_code:string,item_name:string,item_name_vi?:string,amount?:number,item_type?:string}>}} data
 * @param {number} createdBy
 */
export async function createSalaryStructure(data, createdBy) {
  const userId = data?.userId ? Number(data.userId) : null;
  const classId = data?.classId ? Number(data.classId) : null;
  if (!userId && !classId) throw Object.assign(new Error('员工或职类至少填一项'), { statusCode: 400 });
  if (userId) {
    const user = await one(`SELECT id FROM org_user WHERE id = $1`, [userId]);
    if (!user) throw Object.assign(new Error('员工不存在'), { statusCode: 400 });
  } else {
    const cls = await one(`SELECT id FROM salary_class WHERE id = $1`, [classId]);
    if (!cls) throw Object.assign(new Error('职类不存在'), { statusCode: 400 });
  }

  return transaction(async client => {
    // 版本号按「作用域」递增：本人(user_id) 或 职类(class_id)
    const scopeCol = userId ? 'user_id' : 'class_id';
    const scopeVal = userId || classId;
    const cur = (await client.query(
      `SELECT COALESCE(MAX(version), 0)::int AS v FROM salary_structure WHERE ${scopeCol} = $1`,
      [scopeVal]
    )).rows[0];
    const version = (cur?.v || 0) + 1;

    const s = (await client.query(
      `INSERT INTO salary_structure
         (user_id, class_id, version, base_salary, post_allowance, currency,
          ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, effective_from, status, created_by, shift_allowance_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12) RETURNING *`,
      [
        userId, classId, version,
        num(data.baseSalary), num(data.postAllowance), data.currency || 'VND',
        data.otRateWeekday != null ? num(data.otRateWeekday) : 1.5,
        data.otRateWeekend != null ? num(data.otRateWeekend) : 2.0,
        data.otRateHoliday != null ? num(data.otRateHoliday) : 3.0,
        parseDate(data.effectiveFrom), createdBy || null,
        data.shiftAllowanceEnabled !== undefined ? !!data.shiftAllowanceEnabled : true,
      ]
    )).rows[0];

    await saveItems(client, s.id, data.items);
    if (data.lines !== undefined) await saveLines(client, s.id, data.lines);
    return s;
  });
}

/**
 * 更新薪资架构（仅允许 draft 状态；approved/archived 不可改）。
 * @param {number} id
 * @param {object} data 同 createSalaryStructure（items 传入则整体覆盖）
 */
export async function updateSalaryStructure(id, data) {
  const cur = await one(`SELECT * FROM salary_structure WHERE id = $1`, [id]);
  if (!cur) throw Object.assign(new Error('薪资架构不存在'), { statusCode: 404 });
  if (cur.status !== 'draft') {
    throw Object.assign(new Error('仅草稿状态可修改'), { statusCode: 400 });
  }

  await transaction(async client => {
    await client.query(
      `UPDATE salary_structure SET
         base_salary = $2, post_allowance = $3, currency = $4,
         ot_rate_weekday = $5, ot_rate_weekend = $6, ot_rate_holiday = $7,
         effective_from = $8, shift_allowance_enabled = $9
       WHERE id = $1`,
      [
        id,
        data.baseSalary != null ? num(data.baseSalary) : num(cur.base_salary),
        data.postAllowance != null ? num(data.postAllowance) : num(cur.post_allowance),
        data.currency || cur.currency || 'VND',
        data.otRateWeekday != null ? num(data.otRateWeekday) : num(cur.ot_rate_weekday),
        data.otRateWeekend != null ? num(data.otRateWeekend) : num(cur.ot_rate_weekend),
        data.otRateHoliday != null ? num(data.otRateHoliday) : num(cur.ot_rate_holiday),
        data.effectiveFrom !== undefined ? parseDate(data.effectiveFrom) : cur.effective_from,
        data.shiftAllowanceEnabled !== undefined ? !!data.shiftAllowanceEnabled : !!cur.shift_allowance_enabled,
      ]
    );
    if (data.items !== undefined) {
      await client.query(`DELETE FROM salary_structure_item WHERE structure_id = $1`, [id]);
      await saveItems(client, id, data.items);
    }
    if (data.lines !== undefined) {
      await client.query(`DELETE FROM salary_structure_line WHERE structure_id = $1`, [id]);
      await saveLines(client, id, data.lines);
    }
  });
  return getSalaryStructure(id);
}

/** 写入明细项 */
async function saveItems(client, structureId, items) {
  if (!Array.isArray(items)) return;
  for (const it of items) {
    if (!it || !it.item_code || !it.item_name) continue;
    const type = it.item_type === 'deduction' ? 'deduction' : 'allowance';
    await client.query(
      `INSERT INTO salary_structure_item
         (structure_id, item_code, item_name, item_name_vi, amount, item_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [structureId, String(it.item_code), String(it.item_name), it.item_name_vi || null, num(it.amount), type]
    );
  }
}

/**
 * 审批薪资架构（draft → approved；同员工旧 approved 自动 archived）。
 * @param {number} id
 * @param {number} approvedBy
 */
export async function approveSalaryStructure(id, approvedBy) {
  const cur = await one(`SELECT * FROM salary_structure WHERE id = $1`, [id]);
  if (!cur) throw Object.assign(new Error('薪资架构不存在'), { statusCode: 404 });
  if (cur.status === 'approved') return getSalaryStructure(id);
  if (cur.status === 'archived') {
    throw Object.assign(new Error('已归档版本不可审批'), { statusCode: 400 });
  }

  const lineRows = await loadLines(cur.id);
  const isProject = lineRows.length > 0;

  await transaction(async client => {
    const scopeCol = cur.user_id ? 'user_id' : 'class_id';
    const scopeVal = cur.user_id || cur.class_id;
    if (isProject) {
      // 项目驱动：不同 effective_from 保留为历史分段，仅归档同生效日的旧版本
      await client.query(
        `UPDATE salary_structure SET status = 'archived'
          WHERE ${scopeCol} = $1 AND status = 'approved' AND id <> $2
            AND (effective_from IS NOT DISTINCT FROM $3 OR $3 IS NULL)`,
        [scopeVal, id, cur.effective_from || null]
      );
    } else {
      // 老口径：保持单版本语义，审批新版归档所有旧 approved
      await client.query(
        `UPDATE salary_structure SET status = 'archived'
          WHERE ${scopeCol} = $1 AND status = 'approved' AND id <> $2`,
        [scopeVal, id]
      );
    }
    await client.query(
      `UPDATE salary_structure SET status = 'approved', approved_by = $2, approved_at = now()
        WHERE id = $1`,
      [id, approvedBy || null]
    );
  });
  return getSalaryStructure(id);
}

// ============================================================
// 一·五、职类树 CRUD
// ============================================================

export async function listSalaryClasses() {
  const rows = await many(`SELECT * FROM salary_class ORDER BY sort_order, id`);
  const byId = new Map(rows.map(r => [Number(r.id), { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(Number(node.parent_id))) byId.get(Number(node.parent_id)).children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getSalaryClass(id) {
  const r = await one(`SELECT * FROM salary_class WHERE id = $1`, [Number(id)]);
  if (!r) return null;
  const children = await many(`SELECT * FROM salary_class WHERE parent_id = $1 ORDER BY sort_order, id`, [Number(id)]);
  return { ...r, children };
}

export async function saveSalaryClass(data) {
  const id = data.id ? Number(data.id) : null;
  const code = data.code ? String(data.code).trim() : null;
  if (!data.name) throw Object.assign(new Error('职类名称必填'), { statusCode: 400 });
  if (id) {
    await query(
      `UPDATE salary_class SET parent_id=$2, code=$3, name=$4, name_vi=$5, default_card_rule_code=$6, sort_order=$7, active=$8
        WHERE id=$1`,
      [id, data.parentId ? Number(data.parentId) : null, code, data.name, data.name_vi || null,
       data.defaultCardRuleCode || null, Number(data.sortOrder) || 0, data.active !== false]
    );
    return getSalaryClass(id);
  }
  const r = await one(
    `INSERT INTO salary_class (parent_id, code, name, name_vi, default_card_rule_code, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.parentId ? Number(data.parentId) : null, code, data.name, data.name_vi || null,
     data.defaultCardRuleCode || null, Number(data.sortOrder) || 0, data.active !== false]
  );
  return getSalaryClass(r.id);
}

export async function deleteSalaryClass(id) {
  const r = await query(`DELETE FROM salary_class WHERE id = $1`, [Number(id)]);
  if (!r.rowCount) throw Object.assign(new Error('职类不存在'), { statusCode: 404 });
  return { ok: true };
}

// ============================================================
// 一·七、职类分配（批量匹配 + 个别覆盖）
//   · salary_assignment 是「按天解析职类」的权威记录；
//   · org_user.salary_class_id 仅作当前值缓存：生效日 ≤ 今天才同步过去，
//     避免未来生效的分配提前改变当前职类。
// ============================================================

/** 今天（UTC 'YYYY-MM-DD'，与全库 UTC 口径一致） */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 批量分配职类（同一职类 × N 人 × 同一生效日）。
 * 逐人返回 { userId, ok, reason }：查无此人只影响本人，不拖垮整批。
 * @param {{userIds:number[], classId:number, effectiveFrom:string, source?:string}} data
 * @param {number} createdBy
 */
export async function assignSalaryClassBatch({ userIds, classId, effectiveFrom, source } = {}, createdBy) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds])
    .map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw Object.assign(new Error('请选择员工'), { statusCode: 400 });

  const classIdN = Number(classId);
  if (!classIdN) throw Object.assign(new Error('请选择职类'), { statusCode: 400 });
  const cls = await one(`SELECT id FROM salary_class WHERE id = $1`, [classIdN]);
  if (!cls) throw Object.assign(new Error('职类不存在'), { statusCode: 400 });

  const eff = parseDate(effectiveFrom);
  if (!eff) throw Object.assign(new Error('生效日期应为 YYYY-MM-DD'), { statusCode: 400 });
  const src = source === 'single' ? 'single' : 'batch';

  const existRows = await many(`SELECT id FROM org_user WHERE id = ANY($1::bigint[])`, [ids]);
  const exist = new Set(existRows.map(r => Number(r.id)));
  const writable = ids.filter(id => exist.has(id));

  if (writable.length) {
    // 同一人同一天重复分配 → 覆盖为最新一次（源/操作人同步刷新）
    await query(
      `INSERT INTO salary_assignment (user_id, class_id, effective_from, source, created_by)
       SELECT x, $2, $3::date, $4, $5 FROM unnest($1::bigint[]) AS x
       ON CONFLICT (user_id, effective_from) DO UPDATE SET
         class_id = EXCLUDED.class_id, source = EXCLUDED.source, created_by = EXCLUDED.created_by`,
      [writable, classIdN, eff, src, createdBy || null]
    );
    if (eff <= todayUtc()) {
      await query(`UPDATE org_user SET salary_class_id = $1 WHERE id = ANY($2::bigint[])`, [classIdN, writable]);
    }
  }

  const results = ids.map(id => (exist.has(id)
    ? { userId: id, ok: true, reason: null }
    : { userId: id, ok: false, reason: '员工不存在' }));
  return {
    classId: classIdN, effectiveFrom: eff, source: src,
    total: ids.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  };
}

/** 单人分配 / 个别覆盖入口 */
export async function assignSalaryClass(userId, classId, effectiveFrom, source, createdBy) {
  const r = await assignSalaryClassBatch(
    { userIds: [userId], classId, effectiveFrom, source: source || 'single' },
    createdBy
  );
  const hit = r.results[0];
  if (!hit?.ok) throw Object.assign(new Error(hit?.reason || '分配失败'), { statusCode: 400 });
  return hit;
}

/**
 * 职类分配记录列表（未传 page 返回数组）。
 * @param {{userId?:number, classId?:number, page?:number, pageSize?:number}} opts
 */
export async function listSalaryAssignments({ userId, classId, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND a.user_id = $${params.length}`; }
  if (classId) { params.push(Number(classId)); where += ` AND a.class_id = $${params.length}`; }

  const selectSql =
    `SELECT a.*, u.real_name, u.employee_no, c.name AS class_name, c.name_vi AS class_name_vi
       FROM salary_assignment a
       JOIN org_user u ON u.id = a.user_id
       LEFT JOIN salary_class c ON c.id = a.class_id
      WHERE ${where}
      ORDER BY a.effective_from DESC, a.user_id`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM salary_assignment a WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

// ============================================================
// 一·六、月度绩效考核结果（流程终态钩子 + 只读查询）
// ============================================================

/**
 * 月度绩效考核流程终态回调（幂等）。
 * 逻辑：从 flow_instance.form_data 取 period + rows（绩效明细数组），
 *   逐行 upsert performance_record（UNIQUE(user_id, period) 收敛）。
 *   重复调用同值覆盖，结果一致。
 * @param {number} instanceId
 */
export async function onPerformanceClosed(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst) return { ok: false, action: 'skipped', reason: '实例不存在' };
    if (inst.def_code !== 'monthly_performance') {
      return { ok: false, action: 'skipped', reason: `非 monthly_performance 流程：${inst.def_code}` };
    }

    const fd = inst.form_data || {};
    const period = String(fd.period || '').trim();
    if (!validPeriod(period)) {
      return { ok: false, action: 'skipped', reason: '缺少合法考核周期', period };
    }
    const rows = Array.isArray(fd.rows) ? fd.rows : [];

    // 校验：系数边界 / 核算方式 / 同员工同月去重 / 员工存在性；坏行跳过，不拖垮整批
    const errors = [];
    const byUser = new Map();
    rows.forEach((r, idx) => {
      const row = idx + 1;
      const userId = Number(r?.user_id);
      if (!Number.isInteger(userId) || userId <= 0) {
        errors.push({ row, reason: '员工ID无效' });
        return;
      }
      const mode = r?.perf_mode;
      if (!['coef', 'abs'].includes(mode)) {
        errors.push({ row, userId, reason: '核算方式应为 coef/abs' });
        return;
      }
      const coefficient = Number(r?.coefficient);
      const adjustAmount = Number(r?.adjust_amount);
      if (mode === 'coef' && (!Number.isFinite(coefficient) || coefficient < 0 || coefficient > 3)) {
        errors.push({ row, userId, reason: '绩效系数应在 0~3' });
        return;
      }
      if (mode === 'abs' && !Number.isFinite(adjustAmount)) {
        errors.push({ row, userId, reason: '增减额应为数字' });
        return;
      }
      if (byUser.has(userId)) {
        errors.push({ row, userId, reason: '同员工同月重复，按最后一行' });
      }
      byUser.set(userId, {
        row, userId, mode,
        coefficient: mode === 'coef' ? coefficient : 0,
        adjustAmount: mode === 'abs' ? adjustAmount : 0,
        note: r.note || null,
      });
    });

    const candidates = [...byUser.values()];
    let writable = candidates;
    if (candidates.length) {
      const ids = candidates.map(c => c.userId);
      const existRows = await many(`SELECT id FROM org_user WHERE id = ANY($1::bigint[])`, [ids]);
      const existSet = new Set(existRows.map(x => Number(x.id)));
      writable = [];
      for (const c of candidates) {
        if (existSet.has(c.userId)) writable.push(c);
        else errors.push({ row: c.row, userId: c.userId, reason: '员工不存在' });
      }
    }

    let written = 0;
    await transaction(async client => {
      for (const c of writable) {
        await client.query(
          `INSERT INTO performance_record
             (user_id, period, perf_mode, coefficient, adjust_amount, source_instance_id, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (user_id, period) DO UPDATE SET
             perf_mode = EXCLUDED.perf_mode,
             coefficient = EXCLUDED.coefficient,
             adjust_amount = EXCLUDED.adjust_amount,
             source_instance_id = EXCLUDED.source_instance_id,
             note = EXCLUDED.note,
             created_at = now()`,
          [c.userId, period, c.mode, c.coefficient, c.adjustAmount, instanceId, c.note]
        );
        written++;
      }
    });
    return { ok: true, action: 'written', period, written, skipped: errors.length, errors };
  } catch (err) {
    console.warn(`[salary-service] onPerformanceClosed 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}

/** 绩效结果列表（只读，salary:manage）。period/user 过滤，未传 page 返回数组。 */
export async function listPerformanceRecords({ period, userId, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (period) { params.push(String(period)); where += ` AND p.period = $${params.length}`; }
  if (userId) { params.push(Number(userId)); where += ` AND p.user_id = $${params.length}`; }

  const selectSql =
    `SELECT p.*, u.real_name, u.employee_no
       FROM performance_record p JOIN org_user u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY p.period DESC, p.user_id`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM performance_record p WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

// ============================================================
// 二、试算 generateSalary
// ============================================================

/**
 * 薪资试算：按最新 approved 架构 + 该月考勤汇总生成/覆盖 salary_record。
 *
 * 计算口径：
 *   · 基本工资 base_salary：取架构基本工资（满勤）。缺勤按日扣减：
 *       日工资 = base_salary / 当月天数；扣减 = 日工资 * 缺勤天数。
 *   · 加班费 ot_pay：各加班工时 × 小时费率 × 倍率：
 *       小时费率 = base_salary / (当月天数 × 8)
 *       ot_pay = Σ(ot_hours × 小时费率 × 对应倍率 × 班次倍率加成)
 *   · 津贴 allowances：架构明细 item_type='allowance' 合计 + 班次津贴。
 *   · 扣款 deductions：架构明细 item_type='deduction' 合计 + 缺勤扣减 + 个人保险 + 工会费。
 *   · 应发 gross = base_salary + ot_pay + allowances
 *   · 实发 net   = gross - deductions（公司保险仅告知，不进 gross/net）
 *   · 无 approved 结构可用的员工跳过。
 *
 * 【班次待遇（2026-10-12 新增，两种口径都做上，用户尚未最终选定）】
 *   口径① 班次津贴：读 attendance_summary.shift（真实班次，来自排班）分组统计，
 *        按 attendance_shift_def 的 allowance_per_day（元/天）与
 *        allowance_per_hour（元/小时）累加，计入 allowances。
 *        受架构开关 shift_allowance_enabled 控制。
 *   口径② 班次加班倍率加成：该班次加班工时 × 小时费率 × 基础倍率 × ot_rate_factor。
 *   两者互不干扰；无班次配置或无排班数据时金额恒为 0（对既有试算零副作用）。
 *
 * @param {string} period 'YYYY-MM'
 * @param {number} [userId] 指定员工则只算该员工
 * @returns {Promise<{period:string, generated:number, skipped:number, records:Array}>}
 */
/**
 * 取某员工当月候选结构：本人 approved 结构 + 本月可能生效的职类模板（含分配历史里的职类）。
 * @param {{id:number, salary_class_id?:number}} user
 * @param {string} monthEnd 当月最后一天 'YYYY-MM-DD'（只取此前可能生效的分配）
 */
async function loadApplicableStructures(user, monthEnd) {
  const personal = await many(
    `SELECT * FROM salary_structure
      WHERE user_id = $1 AND status = 'approved'
      ORDER BY COALESCE(effective_from, '0001-01-01'::date), version DESC`,
    [Number(user.id)]
  );
  // 分配历史：权威记录，按天解析职类（org_user.salary_class_id 只是当前值缓存）
  const assignments = await many(
    `SELECT class_id, effective_from FROM salary_assignment
      WHERE user_id = $1 AND effective_from <= $2::date
      ORDER BY effective_from`,
    [Number(user.id), monthEnd]
  );
  const classIds = new Set(assignments.map(a => Number(a.class_id)).filter(Boolean));
  if (user.salary_class_id) classIds.add(Number(user.salary_class_id));
  let classList = [];
  if (classIds.size) {
    classList = await many(
      `SELECT * FROM salary_structure
        WHERE user_id IS NULL AND status = 'approved' AND class_id = ANY($1::bigint[])
        ORDER BY COALESCE(effective_from, '0001-01-01'::date), version DESC`,
      [[...classIds]]
    );
  }
  for (const s of [...personal, ...classList]) s.lines = await loadLines(s.id);
  return { personal, classList, assignments };
}

/** 某日生效的职类：分配历史里 effective_from ≤ 当天的最新一条；无则回退当前值缓存 */
function classIdForDay(date, assignments, fallbackClassId) {
  let best = null;
  for (const a of assignments || []) {
    if (String(a.effective_from) > date) continue;
    if (!best || String(a.effective_from) >= String(best.effective_from)) best = a;
  }
  if (best) return Number(best.class_id);
  return fallbackClassId ? Number(fallbackClassId) : null;
}

/** 某日生效结构：本人结构优先于职类模板；同作用域取 effective_from <= date 的最新版本 */
function structureForDay(date, personal, classList, assignments, fallbackClassId) {
  const pick = list => {
    let best = null;
    for (const s of list) {
      if (s.effective_from && s.effective_from > date) continue;
      if (!best) { best = s; continue; }
      const bEff = best.effective_from || '0001-01-01';
      const sEff = s.effective_from || '0001-01-01';
      if (sEff > bEff) best = s;
      else if (sEff === bEff && s.version > best.version) best = s;
    }
    return best;
  };
  const own = pick(personal);
  if (own) return own;
  const classId = classIdForDay(date, assignments, fallbackClassId);
  if (!classId) return null;
  return pick((classList || []).filter(s => Number(s.class_id) === classId));
}

/**
 * 保险/工会费「按天」金额：
 *   · fixed      → value（元/月），按当日权重折算；
 *   · base_ratio → 缴费基数 × value%（基数 base_field=base 取当天底薪、gross 取当月应发，
 *                  再按 config.floor / config.cap 夹逼）；
 * 折算口径与其它固定项一致：金额 × 当日权重 ÷ 当月工作日 → 满月时恒等于「基数×比例」。
 * @returns {{amount:number, info:object}} amount 为「已乘权重」的日累计贡献
 */
function insuranceDayAccrual(line, { baseVal, grossBase, weight, denom }) {
  const cfg = line.config || {};
  const baseField = cfg.base_field === 'gross' ? 'gross' : 'base';
  const rate = num(line.value);
  let base = 0;
  let amount = 0;
  if (line.calc_mode === 'base_ratio') {
    base = baseField === 'gross' ? grossBase : baseVal;
    const floor = cfg.floor == null || cfg.floor === '' ? null : num(cfg.floor);
    const cap = cfg.cap == null || cfg.cap === '' ? null : num(cfg.cap);
    if (floor != null && base < floor) base = floor;
    if (cap != null && base > cap) base = cap;
    amount = base * rate / 100;
  } else {
    amount = rate;   // fixed：value 即月度固定额
  }
  return {
    amount: denom > 0 ? amount * weight / denom : 0,
    info: {
      code: line.code, name: line.name, name_vi: line.name_vi || null,
      calc_mode: line.calc_mode, base_field: baseField,
      base: round2(base), rate,
      cap: cfg.cap == null || cfg.cap === '' ? null : num(cfg.cap),
      floor: cfg.floor == null || cfg.floor === '' ? null : num(cfg.floor),
    },
  };
}

/** 汇总三类保险/工会费：同一（结构, 项目）跨天累加，供 detail 展示明细 */
function accumulateInsurance(sumMap, accrual, structureId) {
  const key = `${structureId}:${accrual.info.code}`;
  const cur = sumMap.get(key);
  if (cur) { cur.accrual += accrual.amount; return; }
  sumMap.set(key, { ...accrual.info, structure_id: structureId, accrual: accrual.amount });
}

/** 把累计结果转成 { total, detail }；total 按币种口径保留两位（导出层再取整） */
function insuranceSummary(sumMap) {
  const detail = [...sumMap.values()].map(x => ({ ...x, accrual: undefined, amount: round2(x.accrual) }));
  const total = round2(detail.reduce((a, b) => a + b.amount, 0));
  return { total, detail };
}

/**
 * 工会费定额（绝对值，2026-10-28 用户口径）。
 * 真值在 salary_insurance_rate.code='union'（mode=fixed + employee_fixed，按生效日取版本）；
 * 仅当老库没有该行时才退回参数 union_fee_fixed。非工会会员一律 0。
 */
async function unionFixedFee(userId, period) {
  const [py, pm] = String(period).split('-').map(Number);
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const monthEnd = period + '-' + String(lastDay).padStart(2, '0');

  const member = await one(
    `SELECT union_member FROM salary_stat_profile
      WHERE user_id = $1 AND period_from <= $2
      ORDER BY period_from DESC LIMIT 1`,
    [userId, period]
  );
  if (!member || member.union_member !== true) {
    return { total: 0, detail: [{ code: 'union_fee', name: '工会费', amount: 0, note: '非工会会员' }] };
  }

  const row = await one(
    `SELECT code, name, mode, employee_fixed FROM salary_insurance_rate
      WHERE region_code = 'VN' AND code = 'union' AND active
        AND effective_from <= $1::date
        AND (effective_to IS NULL OR effective_to >= $1::date)
      ORDER BY effective_from DESC LIMIT 1`,
    [monthEnd]
  );

  let amount = row && String(row.mode) === 'fixed' ? num(row.employee_fixed) : 0;
  if (!amount) {
    const p = await one(
      `SELECT param_value FROM salary_param WHERE param_key = 'union_fee_fixed'
        ORDER BY effective_from DESC LIMIT 1`
    );
    amount = num(p?.param_value);
  }
  return {
    total: round2(amount),
    detail: [{
      code: 'union_fee',
      name: row?.name || '工会费',
      amount: round2(amount),
      note: '每人每月定额'
    }]
  };
}

// ============================================================
// 个人所得税（PIT / thuế thu nhập cá nhân）—— 2026-10-26 新增
// ------------------------------------------------------------
// 原实现完全没有个税：全文件搜索 tax / PIT / 个税 零命中，
// 工资条导出 15 列也没有个税列 → 实发金额偏大，等于漏代扣代缴。
//
// 计算口径（越南 2026 税年起，5 级累进）：
//   应税所得 = 应发(gross)
//            − 强制个人保险（BHXH/BHYT/BHTN，免税）
//            − 工会费
//            − 本人减除（默认 15,500,000）
//            − 抚养人数 × 每名减除（默认 6,200,000）
//   应纳税额 = 应税所得 × 适用税率 − 速算扣除数
// 非居民（resident=false）不适用减除，按 20% 单一税率（越南对外籍非居民口径）。
// ============================================================

const NON_RESIDENT_RATE = 0.20;

/** 读取不高于指定日期的最近一版税率表 */
async function getPitBrackets(asOfDate) {
  const row = await one(
    `SELECT MAX(effective_from) AS ef FROM salary_tax_bracket WHERE effective_from <= $1::date`,
    [asOfDate]
  );
  const ef = row?.ef;
  if (!ef) return { effectiveFrom: null, brackets: [] };
  const list = await many(
    `SELECT seq, lower_bound, rate, quick_deduction FROM salary_tax_bracket
      WHERE effective_from = $1::date ORDER BY lower_bound`,
    [ef]
  );
  return {
    effectiveFrom: ef,
    brackets: list.map(b => ({
      seq: Number(b.seq),
      lower: num(b.lower_bound),
      rate: num(b.rate),
      quick: num(b.quick_deduction),
    })),
  };
}

/** 取员工个税登记（生效期不晚于当月的最近一条）；无登记 → 0 抚养人、居民 */
async function getTaxProfile(userId, period) {
  const row = await one(
    `SELECT dependents, resident, tax_code, period_from
       FROM salary_tax_profile
      WHERE user_id = $1 AND period_from <= $2
      ORDER BY period_from DESC LIMIT 1`,
    [userId, period]
  );
  return {
    dependents: row ? Number(row.dependents) || 0 : 0,
    resident: row ? row.resident !== false : true,
    taxCode: row?.tax_code || null,
    registered: !!row,
    periodFrom: row?.period_from || null,
  };
}

/**
 * 计算个人所得税。
 * @param {{gross:number, insurance:number, unionFee:number,
 *          dependents:number, resident:boolean,
 *          selfDeduction:number, dependentDeduction:number,
 *          brackets:Array<{lower:number,rate:number,quick:number}>}} p
 * @returns {{pit:number, taxableIncome:number, deduction:number, bracket:object|null,
 *            detail:{gross,insurance,unionFee,selfDeduction,dependentDeduction,totalDeduction,rate,quick}}}
 */
function computePit(p) {
  const gross = num(p.gross);
  const insurance = Math.max(0, num(p.insurance));
  const unionFee = Math.max(0, num(p.unionFee));
  const dependents = Math.max(0, Math.floor(num(p.dependents)));
  const brackets = Array.isArray(p.brackets) ? p.brackets : [];

  // 非居民：不享受减除，按单一税率对「应发 − 保险」课征
  if (p.resident === false) {
    const base = Math.max(0, gross - insurance);
    const pit = round2(base * NON_RESIDENT_RATE);
    return {
      pit,
      taxableIncome: round2(base),
      deduction: 0,
      bracket: null,
      detail: {
        gross: round2(gross), insurance: round2(insurance), unionFee: round2(unionFee),
        resident: false, rate: NON_RESIDENT_RATE, quick: 0,
        selfDeduction: 0, dependentDeduction: 0, totalDeduction: 0,
      },
    };
  }

  if (!brackets.length) {
    return {
      pit: 0, taxableIncome: 0, deduction: 0, bracket: null,
      detail: { gross: round2(gross), insurance: round2(insurance), unionFee: round2(unionFee), brackets_missing: true },
    };
  }

  const selfDeduction = Math.max(0, num(p.selfDeduction));
  const perDependent = Math.max(0, num(p.dependentDeduction));
  const dependentDeduction = dependents * perDependent;
  const totalDeduction = selfDeduction + dependentDeduction;
  const taxableIncome = Math.round(Math.max(0, gross - insurance - unionFee - totalDeduction));

  let picked = brackets[0];
  for (const b of brackets) if (taxableIncome >= b.lower) picked = b;

  const pit = taxableIncome > 0
    ? Math.round(Math.max(0, taxableIncome * picked.rate - picked.quick))
    : 0;

  return {
    pit,
    taxableIncome,
    deduction: totalDeduction,
    bracket: picked,
    detail: {
      gross: round2(gross), insurance: round2(insurance), unionFee: round2(unionFee),
      resident: true, dependents,
      selfDeduction, dependentDeduction, perDependent, totalDeduction,
      rate: picked.rate, quick: picked.quick, level: picked.seq,
    },
  };
}

/** 读取个税开关与减除额配置 */
async function getPitConfig() {
  // 兼容两种键名：迁移 94 写入的是 salary_pit_self_deduction / salary_pit_dependent_deduction，
  // 早期代码读过 salary_self_deduction / salary_dependent_deduction。两个都认，优先带 pit_ 的。
  const keys = [
    'salary_pit_enabled', 'salary_pit_self_deduction', 'salary_pit_dependent_deduction',
    'salary_self_deduction', 'salary_dependent_deduction',
  ];
  const rows = await many(
    `SELECT key, value FROM sys_config WHERE key = ANY($1::text[])`, [keys]
  );
  const m = new Map(rows.map(r => [r.key, r.value]));
  const pick = (a, b, dft) => {
    const v = m.get(a);
    if (v !== undefined && v !== null && String(v).trim() !== '') return num(v);
    const w = m.get(b);
    if (w !== undefined && w !== null && String(w).trim() !== '') return num(w);
    return dft;
  };
  return {
    enabled: String(m.get('salary_pit_enabled') ?? 'true').toLowerCase() !== 'false',
    selfDeduction: pick('salary_pit_self_deduction', 'salary_self_deduction', 15500000),
    dependentDeduction: pick('salary_pit_dependent_deduction', 'salary_dependent_deduction', 6200000),
  };
}

/** 老口径试算（无 line 的结构，与改造前完全一致） */
async function computeLegacySalary(struct, user, period, monthDays, monthStart, monthEnd) {
  const items = await many(`SELECT * FROM salary_structure_item WHERE structure_id = $1 ORDER BY id`, [struct.id]);
  const sums = await many(
    `SELECT COALESCE(SUM(normal_hours),0) AS normal_hours,
            COALESCE(SUM(ot_weekday_hours),0) AS ot_weekday,
            COALESCE(SUM(ot_weekend_hours),0) AS ot_weekend,
            COALESCE(SUM(ot_holiday_hours),0) AS ot_holiday,
            COALESCE(SUM(leave_hours),0) AS leave_hours,
            COUNT(*) FILTER (WHERE absent = TRUE)::int AS absent_days
       FROM attendance_summary
      WHERE user_id = $1 AND work_date BETWEEN $2::date AND $3::date`,
    [Number(user.id), monthStart, monthEnd]
  );
  const agg = sums[0] || {};
  const baseSalary = num(struct.base_salary);
  const hourRate = round2(monthDays > 0 ? baseSalary / (monthDays * 8) : 0);
  const otWeekdayHours = num(agg.ot_weekday);
  const otWeekendHours = num(agg.ot_weekend);
  const otHolidayHours = num(agg.ot_holiday);

  const shiftRows = await many(
    `SELECT s.shift AS code, COUNT(*)::int AS days,
            COALESCE(SUM(s.normal_hours + s.ot_weekday_hours + s.ot_weekend_hours + s.ot_holiday_hours), 0) AS hours,
            COALESCE(SUM(s.ot_weekday_hours),0) AS ot_weekday,
            COALESCE(SUM(s.ot_weekend_hours),0) AS ot_weekend,
            COALESCE(SUM(s.ot_holiday_hours),0) AS ot_holiday
       FROM attendance_summary s
      WHERE s.user_id = $1 AND s.work_date BETWEEN $2::date AND $3::date AND s.shift IS NOT NULL
      GROUP BY s.shift`,
    [Number(user.id), monthStart, monthEnd]
  );
  const shiftDefRows = shiftRows.length
    ? await many(`SELECT * FROM attendance_shift_def WHERE code = ANY($1::text[])`, [shiftRows.map(r => r.code)])
    : [];
  const shiftDefMap = new Map(shiftDefRows.map(r => [r.code, r]));
  let shiftAllowance = 0; const shiftAllowanceDetail = [];
  let shiftOtBonus = 0; const shiftOtDetail = [];
  for (const sr of shiftRows) {
    const sd = shiftDefMap.get(sr.code);
    if (!sd) continue;
    const days = Number(sr.days) || 0; const hours = num(sr.hours);
    const perDay = num(sd.allowance_per_day); const perHour = num(sd.allowance_per_hour);
    const amt = round2(perDay * days + perHour * hours);
    if (amt !== 0) { shiftAllowance += amt; shiftAllowanceDetail.push({ shift: sr.code, shift_name: sd.name, days, hours: round2(hours), per_day: perDay, per_hour: perHour, amount: amt }); }
    const factor = num(sd.ot_rate_factor) || 1;
    if (factor !== 1) {
      const bonus = round2((num(sr.ot_weekday) * hourRate * num(struct.ot_rate_weekday) + num(sr.ot_weekend) * hourRate * num(struct.ot_rate_weekend) + num(sr.ot_holiday) * hourRate * num(struct.ot_rate_holiday)) * (factor - 1));
      if (bonus !== 0) { shiftOtBonus += bonus; shiftOtDetail.push({ shift: sr.code, shift_name: sd.name, factor, amount: bonus }); }
    }
  }
  shiftAllowance = round2(shiftAllowance); shiftOtBonus = round2(shiftOtBonus);
  const shiftAllowanceApplied = struct.shift_allowance_enabled !== false ? shiftAllowance : 0;
  const otPayBase = round2(otWeekdayHours * hourRate * num(struct.ot_rate_weekday) + otWeekendHours * hourRate * num(struct.ot_rate_weekend) + otHolidayHours * hourRate * num(struct.ot_rate_holiday));
  const otPay = round2(otPayBase + shiftOtBonus);
  let allowances = 0, deductions = 0;
  for (const it of items) {
    if (it.item_type === 'deduction') deductions += num(it.amount); else allowances += num(it.amount);
  }
  allowances = round2(allowances + shiftAllowanceApplied);
  const absentDays = Number(agg.absent_days) || 0;
  const dailyWage = round2(monthDays > 0 ? baseSalary / monthDays : 0);
  const absentDeduct = round2(dailyWage * absentDays);
  deductions = round2(deductions + absentDeduct);
  const gross = round2(baseSalary + otPay + allowances);
  const net = round2(gross - deductions);
  const detail = {
    legacy: true, month_days: monthDays, hour_rate: hourRate,
    normal_hours: num(agg.normal_hours), leave_hours: num(agg.leave_hours),
    absent_days: absentDays, absent_deduct: absentDeduct,
    ot: {
      weekday_hours: otWeekdayHours, weekend_hours: otWeekendHours, holiday_hours: otHolidayHours,
      rate_weekday: num(struct.ot_rate_weekday), rate_weekend: num(struct.ot_rate_weekend), rate_holiday: num(struct.ot_rate_holiday),
      base_pay: otPayBase, shift_bonus: shiftOtBonus, shift_bonus_detail: shiftOtDetail,
    },
    shift_allowance: {
      enabled: struct.shift_allowance_enabled !== false,
      total: shiftAllowanceApplied,
      detail: shiftAllowanceDetail,
    },
    items: items.map(i => ({ code: i.item_code, name: i.item_name, amount: num(i.amount), type: i.item_type })),
  };
  return { baseSalary, otPay, allowances, deductions, gross, net, detail, version: struct.version, currency: struct.currency || 'VND' };
}

/**
 * 薪资试算（项目驱动 + 生效日期分段）。
 * 项目结构（有 line）走逐日分段；无 line 的老结构走 legacy 口径（与改造前一致）。
 */
export async function generateSalary(period, userId) {
  if (!validPeriod(period)) {
    throw Object.assign(new Error('薪资周期格式应为 YYYY-MM'), { statusCode: 400 });
  }
  const monthDays = daysInMonth(period);
  const monthStart = `${period}-01`;
  const monthEnd = `${period}-${String(monthDays).padStart(2, '0')}`;

  // 工作日分母：日历 Σ 权重；无日历回退自然日
  const calendar = await getWorkCalendar(period);
  const weights = new Map();
  let denom = 0;
  for (let d = 1; d <= monthDays; d++) {
    const dd = String(d).padStart(2, '0');
    const raw = calendar ? Number(calendar.days?.[dd]) : 1;
    const w = Number.isFinite(raw) ? raw : 1;   // 缺省按 1 全天工作日（与考勤侧 calendarWeight 一致）
    weights.set(dd, w);
    denom += w;
  }
  if (denom <= 0) denom = monthDays;

  // 个税：开关 + 当月适用税率表（一次性读取，循环内不再查库）
  const pitCfg = await getPitConfig();
  const pitTable = pitCfg.enabled ? await getPitBrackets(monthEnd) : { effectiveFrom: null, brackets: [] };

  // 候选员工：本人 approved 结构 / 挂了职类 / 当月有职类分配记录
  const cond = [];
  const params = [];
  if (userId) { params.push(Number(userId)); cond.push(`id = $${params.length}`); }
  const classUsers = await many(
    `SELECT id, salary_class_id FROM org_user WHERE salary_class_id IS NOT NULL${cond.length ? ` AND ${cond.join(' AND ')}` : ''}`,
    params
  );
  const sp = [];
  if (userId) sp.push(Number(userId));
  const personalUsers = await many(
    `SELECT DISTINCT user_id AS id FROM salary_structure WHERE status='approved' AND user_id IS NOT NULL${userId ? ` AND user_id = $1` : ''}`,
    sp
  );
  // 分配记录可能先于 org_user.salary_class_id 缓存生效（未来生效日的分配），故单独收候选人
  const ap = [monthEnd];
  if (userId) ap.push(Number(userId));
  const assignUsers = await many(
    `SELECT DISTINCT user_id AS id FROM salary_assignment
      WHERE effective_from <= $1::date${userId ? ' AND user_id = $2' : ''}`,
    ap
  );
  const candMap = new Map();
  for (const u of [...classUsers, ...personalUsers, ...assignUsers]) {
    const id = Number(u.id);
    const cur = candMap.get(id);
    if (!cur) candMap.set(id, { id, salary_class_id: u.salary_class_id || null });
    else if (!cur.salary_class_id && u.salary_class_id) cur.salary_class_id = u.salary_class_id;
  }

  let generated = 0, skipped = 0;
  const records = [];
  // 被「已确认工资单」挡下、拒绝覆盖的员工（QA 缺陷 B5）：绝不静默，汇总后整体报 409
  const locked = [];

  for (const user of candMap.values()) {
    const { personal, classList, assignments } = await loadApplicableStructures(user, monthEnd);
    if (!personal.length && !classList.length) { skipped++; continue; }

    // legacy：仅本人、且均无 line
    if (!classList.length && personal.length && personal.every(s => !(s.lines || []).length)) {
      const legacyStruct = [...personal].sort((a, b) => b.version - a.version)[0];
      const r = await computeLegacySalary(legacyStruct, user, period, monthDays, monthStart, monthEnd);
      // 老口径同样代扣个税（该类结构没有保险/工会费明细，保险按 0 计）
      let legacyTax = {};
      let legacyNet = r.net;
      if (pitCfg.enabled && num(r.gross) > 0) {
        const prof = await getTaxProfile(user.id, period);
        const pi = computePit({
          gross: r.gross, insurance: 0, unionFee: 0,
          dependents: prof.dependents, resident: prof.resident,
          selfDeduction: pitCfg.selfDeduction, dependentDeduction: pitCfg.dependentDeduction,
          brackets: pitTable.brackets,
        });
        legacyNet = round2(num(r.net) - pi.pit);
        legacyTax = { pit: pi.pit, taxableIncome: pi.taxableIncome, dependents: prof.dependents, detail: pi.detail };
      }
      const w = await upsertSalaryRecord(user.id, period, r.version, r.baseSalary, r.otPay, r.allowances, r.deductions, r.gross, legacyNet, r.detail, r.currency, legacyTax);
      if (!w.ok) { locked.push(lockEntry(user, w)); continue; }
      records.push(w.row); generated++;
      continue;
    }

    // 项目驱动：逐日归属
    const sumRows = await many(
      `SELECT work_date, day_type, normal_hours, ot_weekday_hours, ot_weekend_hours, ot_holiday_hours,
              late_minutes, early_minutes, absent
         FROM attendance_summary
        WHERE user_id = $1 AND work_date BETWEEN $2::date AND $3::date`,
      [user.id, monthStart, monthEnd]
    );
    const sumByDate = new Map(sumRows.map(r => [String(r.work_date).slice(0, 10), r]));

    let baseSum = 0, perfBaseSum = 0, earningSum = 0, deductionSum = 0, otPay = 0, absentDeduct = 0;
    let perfMode = null, currency = 'VND';
    let lateEarlyRaw = 0, lateEarlyMinutes = 0, lateEarlyTimes = 0;
    let lateEarlyMode = null, lateEarlyRate = 0, lateEarlyCap = null;
    const segmentMap = new Map();
    // 保险/工会费取 base_field=gross 时要有「当月应发」，而应发由逐日收入汇总而来，
    // 故第一遍收集每日收入，第二遍才按当天生效结构算保险（避免循环依赖）。
    const dayList = [];
    const SKIP = new Set(['base', 'perf', 'ot', 'absent', 'late_early', ...INSURANCE_CATS]);
    for (let d = 1; d <= monthDays; d++) {
      const dd = String(d).padStart(2, '0');
      const date = `${period}-${dd}`;
      const st = structureForDay(date, personal, classList, assignments, user.salary_class_id);
      if (!st) continue;
      const w = weights.get(dd) || 0;
      const lines = st.lines || [];
      currency = st.currency || 'VND';

      const baseLine = lines.find(l => l.category === 'base');
      const baseVal = baseLine ? num(baseLine.value) : num(st.base_salary);
      baseSum += baseVal * w;

      // 绩效基础额（固定项按天权重折算；核算方式取首个 perf 行）
      const perfLine = lines.find(l => l.category === 'perf');
      if (perfLine && (perfLine.calc_mode === 'perf_coef' || perfLine.calc_mode === 'perf_abs')) {
        perfBaseSum += num(perfLine.value) * w;
        if (!perfMode) perfMode = perfLine.calc_mode;
      }

      const key = `${st.id}`;
      if (!segmentMap.has(key)) segmentMap.set(key, { structure_id: st.id, version: st.version, class_id: st.class_id, base: baseVal, days: 0 });
      segmentMap.get(key).days++;

      const row = sumByDate.get(date);
      const hourRate = denom > 0 ? baseVal / (denom * 8) : 0;
      const otH = {
        weekday: num(row?.ot_weekday_hours),
        weekend: num(row?.ot_weekend_hours),
        holiday: num(row?.ot_holiday_hours),
      };

      // 加班费由 ot 行驱动：ot_auto=倍率×时薪；ot_custom=三档自定义单价
      const otLine = lines.find(l => l.category === 'ot');
      if (otLine && otLine.calc_mode === 'ot_auto') {
        otPay += otH.weekday * hourRate * num(st.ot_rate_weekday)
               + otH.weekend * hourRate * num(st.ot_rate_weekend)
               + otH.holiday * hourRate * num(st.ot_rate_holiday);
      } else if (otLine && otLine.calc_mode === 'ot_custom') {
        const cfg = otLine.config || {};
        otPay += otH.weekday * num(cfg.weekday)
               + otH.weekend * num(cfg.weekend)
               + otH.holiday * num(cfg.holiday);
      }

      // 缺勤扣款由 absent 行驱动：日薪 × 缺勤天数（按当天生效结构）
      const absentLine = lines.find(l => l.category === 'absent');
      if (absentLine && row?.absent) absentDeduct += denom > 0 ? baseVal / denom : 0;

      // 迟到早退：按当天生效结构 rate/mode 累加，月底按 cap 封顶
      const leLine = lines.find(l => l.category === 'late_early');
      if (leLine) {
        const cfg = leLine.config || {};
        const mode = cfg.mode || 'per_minute';
        const rate = num(cfg.rate);
        const lateMin = num(row?.late_minutes);
        const earlyMin = num(row?.early_minutes);
        lateEarlyMode = mode; lateEarlyRate = rate;
        if (mode === 'per_time') {
          const times = (lateMin > 0 ? 1 : 0) + (earlyMin > 0 ? 1 : 0);
          lateEarlyRaw += times * rate;
          lateEarlyTimes += times;
        } else {
          const mins = lateMin + earlyMin;
          lateEarlyRaw += mins * rate;
          lateEarlyMinutes += mins;
        }
        if (lateEarlyCap === null && cfg.cap != null) lateEarlyCap = num(cfg.cap);
      }

      let earningDay = 0;
      for (const ln of lines) {
        if (SKIP.has(ln.category)) continue;
        const v = num(ln.value);
        if (ln.category === 'earning') {
          if (ln.calc_mode === 'base_ratio') earningDay += (v / 100) * baseVal * w;
          else earningDay += v * w;
        } else if (ln.category === 'deduction') {
          if (ln.calc_mode === 'base_ratio') deductionSum += (v / 100) * baseVal * w;
          else deductionSum += v * w;
        }
      }
      earningSum += earningDay;
      dayList.push({ weight: w, st, baseVal });
    }

    const baseSalary = round2(baseSum / denom);
    const earningAllowances = round2(earningSum / denom);
    const perfBase = round2(perfBaseSum / denom);

    // 绩效：缺绩效结果时 coef 记 1、abs 记 0（口径在 detail.missing_note 注明）
    let perfAmount = 0, perfMissing = false, perfCoef = null, perfAdjust = null;
    const perfRec = perfMode
      ? await one(`SELECT * FROM performance_record WHERE user_id = $1 AND period = $2`, [user.id, period])
      : null;
    if (perfMode === 'perf_coef') {
      perfCoef = perfRec ? num(perfRec.coefficient) : 1;
      perfMissing = !perfRec;
      perfAmount = round2(perfBase * perfCoef);
    } else if (perfMode === 'perf_abs') {
      perfAdjust = perfRec ? num(perfRec.adjust_amount) : 0;
      perfMissing = !perfRec;
      perfAmount = round2(perfBase + perfAdjust);
    }

    let lateEarlyAmount = lateEarlyRaw;
    if (lateEarlyCap != null && lateEarlyAmount > lateEarlyCap) lateEarlyAmount = lateEarlyCap;

    const otPayR = round2(otPay);
    const allowances = round2(earningAllowances + perfAmount);
    // 应发（收入合计，不含任何扣除）：也是个人/公司保险 base_field=gross 时的缴费基数
    const gross = round2(baseSalary + otPayR + allowances);

    // 第二遍：保险（个人/公司）与工会费按「当天生效结构」算，参与分段
    // 工会费例外：2026-10-28 起是**绝对值**（每人每月定额），不按基数比例、也不按天分摊，
    // 所以这里只记录「结构里有没有配工会费」，金额在循环外一次性取。
    const perMap = new Map(), comMap = new Map(), unionMap = new Map();
    let hasUnionLine = false;
    for (const day of dayList) {
      for (const ln of day.st.lines || []) {
        if (!INSURANCE_CATS.has(ln.category)) continue;
        if (ln.category === 'union_fee') { hasUnionLine = true; continue; }
        const acc = insuranceDayAccrual(ln, {
          baseVal: day.baseVal, grossBase: gross, weight: day.weight, denom,
        });
        if (ln.category === 'insurance_personal') accumulateInsurance(perMap, acc, day.st.id);
        else accumulateInsurance(comMap, acc, day.st.id);
      }
    }
    const insPersonal = insuranceSummary(perMap);
    const insCompany = insuranceSummary(comMap);   // 仅告知：不进 gross/net，也不进 deductions
    const unionFee = hasUnionLine
      ? await unionFixedFee(user.id, period)
      : insuranceSummary(unionMap);

    // ---- 个人所得税 ----
    // 应税所得 = 应发 − 个人保险 − 工会费 − 本人减除 − 抚养人减除
    // 保险费与工会费已计入 deductions，个税单列（salary_record.pit），实发 = 应发 − 扣款 − 个税
    let pitInfo = { pit: 0, taxableIncome: 0, deduction: 0, bracket: null, detail: {} };
    let taxDependents = 0;
    if (pitCfg.enabled && gross > 0) {
      const prof = await getTaxProfile(user.id, period);
      taxDependents = prof.dependents;
      pitInfo = computePit({
        gross,
        insurance: insPersonal.total,
        unionFee: unionFee.total,
        dependents: prof.dependents,
        resident: prof.resident,
        selfDeduction: pitCfg.selfDeduction,
        dependentDeduction: pitCfg.dependentDeduction,
        brackets: pitTable.brackets,
      });
      pitInfo.detail = {
        ...pitInfo.detail,
        registered: prof.registered,
        profile_from: prof.periodFrom,
        brackets_effective_from: pitTable.effectiveFrom,
      };
    }

    const deductions = round2(deductionSum / denom + absentDeduct + lateEarlyAmount
                              + insPersonal.total + unionFee.total);
    const net = round2(gross - deductions - pitInfo.pit);
    const detail = {
      projected: true, currency,
      workdays: round2(denom), month_days: monthDays,
      base: round2(baseSalary), ot_pay: otPayR,
      allowances, deductions, earning: earningAllowances,
      absent_deduct: round2(absentDeduct),
      // 三类只在结构里配了才出现（无配置时 detail 与改造前一致，旧数据零变化）
      ...(insPersonal.detail.length ? { insurance_personal: insPersonal } : {}),
      ...(insCompany.detail.length ? { company_insurance: insCompany } : {}),
      ...(unionFee.detail.length ? { union_fee: unionFee } : {}),
      perf: perfMode ? {
        mode: perfMode, base: perfBase, coefficient: perfCoef, adjust_amount: perfAdjust,
        amount: perfAmount, missing: perfMissing,
        missing_note: perfMissing ? (perfMode === 'perf_coef' ? 'coef=1' : 'adjust=0') : null,
      } : null,
      late_early: lateEarlyMode ? {
        mode: lateEarlyMode, rate: lateEarlyRate, minutes: lateEarlyMinutes, times: lateEarlyTimes,
        cap: lateEarlyCap, raw: round2(lateEarlyRaw), amount: round2(lateEarlyAmount),
      } : null,
      // 个税明细：应税所得 / 减除构成 / 适用级距；未启用或应发为 0 时不出现
      ...(pitCfg.enabled && gross > 0 ? {
        pit: {
          amount: pitInfo.pit,
          taxable_income: pitInfo.taxableIncome,
          dependents: taxDependents,
          ...pitInfo.detail,
        },
      } : {}),
      segments: [...segmentMap.values()].map(s => ({ ...s, days: s.days })),
    };
    const w = await upsertSalaryRecord(
      user.id, period, null, baseSalary, otPayR, allowances, deductions, gross, net, detail, currency,
      { pit: pitInfo.pit, taxableIncome: pitInfo.taxableIncome, dependents: taxDependents, detail: pitInfo.detail }
    );
    if (!w.ok) { locked.push(lockEntry(user, w)); continue; }
    records.push(w.row); generated++;
  }

  // 有工资单因「已确认」被拒绝覆盖 → 抛 409，绝不静默当成功（已写入的其余员工保留，消息里说清）
  if (locked.length) {
    const named = await many(
      `SELECT id, employee_no, real_name FROM org_user WHERE id = ANY($1::bigint[])`,
      [locked.map(l => l.userId)]
    ).catch(() => []);
    const byId = new Map(named.map(u => [Number(u.id), u]));
    const who = locked.map(l => {
      const u = byId.get(l.userId);
      const label = u ? `${u.employee_no || ''} ${u.real_name || ''}`.trim() : `userId=${l.userId}`;
      return `${label}(${l.status})`;
    }).join('、');
    const err = Object.assign(
      new Error(
        `试算已被拒绝：${locked.length} 人的 ${period} 工资单已确认/锁定，未覆盖（其余 ${generated} 人已生成）。` +
        `如需重算，请先作废对应工资批次。涉及：${who}`
      ),
      { statusCode: 409, bizCode: 'SALARY_LOCKED', period, locked }
    );
    throw err;
  }

  return { period, generated, skipped, records };
}

/**
 * 组装一条「拒绝覆盖已锁定工资单」的记录，并同步留痕。
 *
 * 留痕取舍（QA 报告建议写 salary_record_log，但该表在 sql/ 下并不存在）：
 *   本任务不允许新建业务表，故复用既有日志能力——生产环境 logger.initFileLog() 已把
 *   console.* tee 到 app/server/logs/oa.log，这条 warn 会落盘且随 10MB 轮转保留 5 份。
 *   需要逐条可查询的审计时，应另立迁移建 salary_record_log，属业务决策，不在本次范围。
 */
function lockEntry(user, res) {
  const entry = {
    userId: Number(user?.id) || null,
    status: res?.existing?.status || 'unknown',
    recordId: res?.existing?.id ?? null,
  };
  console.warn('[salary] 拒绝覆盖已锁定工资单：' + JSON.stringify(entry));
  return entry;
}

/**
 * 写入 / 更新一张工资单（一人一月一条，UNIQUE(user_id, period)）。
 *
 * 【锁定语义 · QA 缺陷 B5】
 *   salary_record.status 的取值域由代码决定（库内无 CHECK 约束）：
 *     draft（试算草稿） / confirmed（批次已确认，工资单锁定） / void（批次已作废）。
 *   `ON CONFLICT DO UPDATE` 带 `WHERE salary_record.status IN ('draft','void')`：
 *     · confirmed → 冲突行被 WHERE 挡掉，**不再覆盖**已确认工资金额；
 *     · void      → 允许重算（作废批次本就失效），但复活为 draft，避免出现「作废行带着新金额」；
 *     · 用白名单 IN ('draft','void') 而非黑名单，将来新增状态（如 paid）默认落到「锁定」一侧，失败安全。
 *
 * 【不再改写 created_at】
 *   原实现 `created_at = now()` 会抹掉首次生成时间；salary_record 无 updated_at 列，
 *   按「不改表结构」的约束，这里直接不更新 created_at。
 *
 * 【零行返回必须可诊断】
 *   WHERE 挡掉冲突时 `RETURNING *` 返回 0 行，原来的 one() 会拿到 undefined，
 *   调用方 records.push(undefined) 后仍然 generated++ → 接口谎报「试算完成」。
 *   这里显式返回结构化结果，由调用方汇总后抛 409。
 *
 * @returns {Promise<{ok:true,row:object}|{ok:false,reason:'locked',existing:{id:number,status:string}|null}>}
 */
async function upsertSalaryRecord(userId, period, version, baseSalary, otPay, allowances, deductions, gross, net, detail, currency, tax = {}) {
  const pit = round2(tax.pit || 0);
  const taxableIncome = round2(tax.taxableIncome || 0);
  const dependents = Number(tax.dependents) || 0;
  const taxDetail = tax.detail || {};
  const row = await one(
    `INSERT INTO salary_record
       (user_id, period, structure_version, base_salary, ot_pay, allowances, deductions, gross, net, detail, currency, status,
        pit, taxable_income, dependents, tax_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,$15)
     ON CONFLICT (user_id, period) DO UPDATE SET
       structure_version = COALESCE(EXCLUDED.structure_version, salary_record.structure_version),
       base_salary = EXCLUDED.base_salary,
       ot_pay = EXCLUDED.ot_pay,
       allowances = EXCLUDED.allowances,
       deductions = EXCLUDED.deductions,
       gross = EXCLUDED.gross,
       net = EXCLUDED.net,
       detail = EXCLUDED.detail,
       currency = EXCLUDED.currency,
       pit = EXCLUDED.pit,
       taxable_income = EXCLUDED.taxable_income,
       dependents = EXCLUDED.dependents,
       tax_detail = EXCLUDED.tax_detail,
       status = CASE WHEN salary_record.status = 'void' THEN 'draft' ELSE salary_record.status END
     WHERE salary_record.status IN ('draft','void')
     RETURNING *`,
    [userId, period, version, baseSalary, otPay, allowances, deductions, gross, net,
     JSON.stringify(detail), currency || 'VND', pit, taxableIncome, dependents, JSON.stringify(taxDetail)]
  );
  if (row) return { ok: true, row };

  // 0 行 = 冲突被 WHERE 挡掉（既不是插入成功，也不是「不存在该行」）。补查现状，供上层出可诊断的 409。
  const existing = await one(
    `SELECT id, status FROM salary_record WHERE user_id = $1 AND period = $2`,
    [userId, period]
  );
  return { ok: false, reason: 'locked', existing: existing || null };
}


// ============================================================
// 三、薪资记录列表 / 导出
// ============================================================

/**
 * 薪资记录列表。
 * @param {{period?:string, userId?:number, page?:number, pageSize?:number}} opts
 */
export async function listSalaryRecords({ period, userId, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (period) { params.push(String(period)); where += ` AND r.period = $${params.length}`; }
  if (userId) { params.push(Number(userId)); where += ` AND r.user_id = $${params.length}`; }

  const selectSql =
    `SELECT r.*, u.real_name, u.employee_no
       FROM salary_record r JOIN org_user u ON u.id = r.user_id
      WHERE ${where}
      ORDER BY r.period DESC, r.user_id`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM salary_record r WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 薪资导出结构（前端生成 xlsx）。表头中越双语。
 * @param {{period?:string, userId?:number}} opts
 * @returns {Promise<{columns:Array, rows:Array}>}
 */
export async function salaryExport({ period, userId } = {}) {
  const columns = [
    { key: 'employee_no',       label: '工号',       label_vi: 'Mã nhân viên' },
    { key: 'real_name',         label: '姓名',       label_vi: 'Họ tên' },
    { key: 'period',            label: '薪资周期',   label_vi: 'Kỳ lương' },
    { key: 'structure_version', label: '架构版本',   label_vi: 'Phiên bản' },
    { key: 'base_salary',       label: '基本工资',   label_vi: 'Lương cơ bản' },
    { key: 'ot_pay',            label: '加班费',     label_vi: 'Tiền tăng ca' },
    { key: 'shift_allowance',   label: '班次津贴',   label_vi: 'Phụ cấp ca' },
    { key: 'allowances',        label: '津贴',       label_vi: 'Phụ cấp' },
    { key: 'deductions',        label: '扣款',       label_vi: 'Khấu trừ' },
    { key: 'insurance_personal', label: '个人保险',   label_vi: 'Bảo hiểm (cá nhân)' },
    { key: 'company_insurance',  label: '公司保险(告知)', label_vi: 'Bảo hiểm (công ty) - thông báo' },
    { key: 'union_fee',          label: '工会费',     label_vi: 'Phí công đoàn' },
    { key: 'taxable_income',     label: '应税所得',   label_vi: 'Thu nhập chịu thuế' },
    { key: 'pit',                label: '个人所得税', label_vi: 'Thuế TNCN' },
    { key: 'dependents',         label: '抚养人数',   label_vi: 'Số người phụ thuộc' },
    { key: 'gross',             label: '应发',       label_vi: 'Tổng gộp' },
    { key: 'net',               label: '实发',       label_vi: 'Thực lĩnh' },
    { key: 'status',            label: '状态',       label_vi: 'Trạng thái' },
  ];
  const list = await listSalaryRecords({ period, userId });
  // 逐行带币种、按币种取整（VND 整数 / CNY 两位）；不做跨币种合计
  const rows = (list || []).map(r => {
    const cur = r.currency || 'VND';
    const rm = v => roundMoney(v, cur);
    return {
      employee_no: r.employee_no,
      real_name: r.real_name,
      period: r.period,
      currency: cur,
      structure_version: r.structure_version,
      base_salary: rm(r.base_salary),
      ot_pay: rm(r.ot_pay),
      // 班次津贴从 detail 里取（已计入 allowances，此处单列便于核对白夜班差异）
      shift_allowance: rm(r.detail?.shift_allowance?.total),
      allowances: rm(r.allowances),
      deductions: rm(r.deductions),
      // 三类保险/工会费从 detail 取（个人保险与工会费已计入 deductions；公司保险仅告知，不进应发实发）
      insurance_personal: rm(r.detail?.insurance_personal?.total),
      company_insurance: rm(r.detail?.company_insurance?.total),
      union_fee: rm(r.detail?.union_fee?.total),
      // 个税：扣款之外单列，实发 = 应发 − 扣款 − 个税
      taxable_income: rm(r.taxable_income),
      pit: rm(r.pit),
      dependents: Number(r.dependents) || 0,
      gross: rm(r.gross),
      net: rm(r.net),
      status: r.status,
    };
  });
  return { columns, rows };
}

// ============================================================
// 四、个人所得税管理接口（2026-10-26 新增）
// ------------------------------------------------------------
// HR 需要能登记每人的抚养人数与税号，否则个税永远按 0 抚养人算，员工会多缴税。
// ============================================================

/** 个税登记列表（可按人筛） */
export async function listTaxProfiles({ userId, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND p.user_id = $${params.length}`; }
  const base =
    `SELECT p.*, u.real_name, u.employee_no
       FROM salary_tax_profile p JOIN org_user u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY p.period_from DESC, p.user_id`;
  if (page === undefined || page === null || page === '') return many(base, params);
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM salary_tax_profile p WHERE ${where}`, params);
  const list = await many(`${base} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/** 登记/修改某人某期起的抚养人数与税号（同人同期覆盖） */
export async function saveTaxProfile(data = {}, createdBy) {
  const userId = Number(data.userId || data.user_id);
  if (!userId) throw Object.assign(new Error('员工必填'), { statusCode: 400 });
  const periodFrom = String(data.periodFrom || data.period_from || '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodFrom)) {
    throw Object.assign(new Error('生效期格式应为 YYYY-MM'), { statusCode: 400 });
  }
  const dependents = Math.max(0, Math.floor(Number(data.dependents) || 0));
  if (dependents > 20) throw Object.assign(new Error('抚养人数不合理（上限 20）'), { statusCode: 400 });
  const resident = data.resident === undefined ? true : !!data.resident;

  const row = await one(
    `INSERT INTO salary_tax_profile
       (user_id, period_from, dependents, resident, tax_code, remark, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, period_from) DO UPDATE SET
       dependents = EXCLUDED.dependents,
       resident = EXCLUDED.resident,
       tax_code = EXCLUDED.tax_code,
       remark = EXCLUDED.remark
     RETURNING *`,
    [userId, periodFrom, dependents, resident,
     data.taxCode || data.tax_code || null, data.remark || null, createdBy || null]
  );
  return row;
}

/** 删除一条登记（录错时用） */
export async function deleteTaxProfile(id) {
  const r = await query(`DELETE FROM salary_tax_profile WHERE id = $1`, [Number(id)]);
  if (!r.rowCount) throw Object.assign(new Error('登记不存在'), { statusCode: 404 });
  return { ok: true };
}

/** 当前生效的个税税率表 + 减除额配置（供界面展示） */
export async function getTaxConfig(asOfDate) {
  const cfg = await getPitConfig();
  const t = await getPitBrackets(asOfDate || new Date().toISOString().slice(0, 10));
  return {
    enabled: cfg.enabled,
    selfDeduction: cfg.selfDeduction,
    dependentDeduction: cfg.dependentDeduction,
    effectiveFrom: t.effectiveFrom,
    brackets: t.brackets,
  };
}

/** 个税试算（不落库）：给定应发、保险、工会费、抚养人数 */
export async function previewPit(data = {}) {
  const cfg = await getPitConfig();
  const t = await getPitBrackets(data.asOfDate || new Date().toISOString().slice(0, 10));
  return computePit({
    gross: num(data.gross),
    insurance: num(data.insurance),
    unionFee: num(data.unionFee || data.union_fee),
    dependents: Math.max(0, Math.floor(num(data.dependents))),
    resident: data.resident === undefined ? true : !!data.resident,
    selfDeduction: data.selfDeduction == null ? cfg.selfDeduction : num(data.selfDeduction),
    dependentDeduction: data.dependentDeduction == null ? cfg.dependentDeduction : num(data.dependentDeduction),
    brackets: t.brackets,
  });
}

// ============================================================
// 个税口径维护（2026-10-28 用户口径：法律经常变，所有金额都要能设置）
// ------------------------------------------------------------
// 三处都能改：
//   1) 开关与两项减除额（本人 / 每名抚养人）→ sys_config
//   2) 累进税率表（每档下限 / 税率 / 速算扣除数）→ salary_tax_bracket，按生效日分版本
//   3) 生效日期（新增一版，不动历史月份）
//
// 设计要点：
//   * 改税率绝不就地改旧版本 —— 历史月份重算必须还能算出原来的数，
//     所以保存时永远是「按生效日整版覆盖（删该日全部档 + 重插）」。
//   * 速算扣除数可以手填，也可以让系统按公式推：
//       quick[i] = lower[i] × (rate[i] − rate[i−1]) + quick[i−1]，quick[0] = 0
//     这正是 94 迁移注释里的校验公式，保证「分段累进」与「速算」等价。
//   * 税率入参同时接受小数（0.05）与百分数（5），统一落库为小数。
// ============================================================

const PIT_CONFIG_KEYS = {
  enabled: 'salary_pit_enabled',
  selfDeduction: 'salary_pit_self_deduction',
  dependentDeduction: 'salary_pit_dependent_deduction'
};

function badRequest(msg) {
  return Object.assign(new Error(msg), { statusCode: 400 });
}

/** 税率归一：允许 5（百分数）或 0.05（小数） */
function normRate(v) {
  const n = num(v);
  if (!Number.isFinite(n) || n < 0) throw badRequest('税率不能为负');
  const r = n > 1 ? n / 100 : n;
  if (r > 1) throw badRequest('税率不能超过 100%');
  return round4(r);
}

/** 校验并规整一版税率表 */
function normalizeBrackets(list) {
  if (!Array.isArray(list) || !list.length) throw badRequest('税率表至少要有一档');
  if (list.length > 15) throw badRequest('税率表最多 15 档');
  const rows = list.map((b, i) => ({
    seq: i + 1,
    lower: Math.max(0, num(b.lower ?? b.lowerBound)),
    rate: normRate(b.rate ?? b.ratePercent),
    quick: Math.max(0, num(b.quick ?? b.quickDeduction))
  }));
  if (rows[0].lower !== 0) throw badRequest('第 1 档下限必须是 0');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].lower <= rows[i - 1].lower) {
      throw badRequest(`第 ${i + 1} 档下限（${rows[i].lower}）必须大于上一档（${rows[i - 1].lower}）`);
    }
    if (rows[i].rate < rows[i - 1].rate) {
      throw badRequest(`第 ${i + 1} 档税率不能低于上一档（累进税率必须递增）`);
    }
  }
  return rows;
}

/** 按分段累进公式推速算扣除数 */
export function suggestQuickDeductions(list = []) {
  const rows = Array.isArray(list) ? list : [];
  let prevRate = 0, prevQuick = 0;
  return rows.map((b, i) => {
    const lower = Math.max(0, num(b.lower ?? b.lowerBound));
    const rate = normRate(b.rate ?? b.ratePercent);
    const quick = i === 0 ? 0 : Math.round(lower * (rate - prevRate) + prevQuick);
    prevRate = rate;
    prevQuick = quick;
    return { seq: i + 1, lower, rate, quick };
  });
}

/** 保存开关与两项减除额 */
export async function saveTaxSettings(data = {}, userId) {
  const patch = [];
  if (data.enabled !== undefined) {
    patch.push([PIT_CONFIG_KEYS.enabled, data.enabled ? 'true' : 'false']);
  }
  for (const [field, key] of [
    ['selfDeduction', PIT_CONFIG_KEYS.selfDeduction],
    ['dependentDeduction', PIT_CONFIG_KEYS.dependentDeduction]
  ]) {
    if (data[field] === undefined || data[field] === null || data[field] === '') continue;
    const v = num(data[field]);
    if (!Number.isFinite(v) || v < 0) throw badRequest('减除额必须是不小于 0 的数字');
    patch.push([key, String(v)]);
  }
  if (!patch.length) throw badRequest('没有要保存的内容');

  for (const [key, value] of patch) {
    await query(
      `INSERT INTO sys_config (key, value, label, updated_at)
       VALUES ($1::text, $2::text, $2::text, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }
  // 老键名同步，避免两套键读出不同数字
  const selfV = patch.find(p => p[0] === PIT_CONFIG_KEYS.selfDeduction);
  const depV = patch.find(p => p[0] === PIT_CONFIG_KEYS.dependentDeduction);
  if (selfV) {
    await query(
      `INSERT INTO sys_config (key, value, label) VALUES ('salary_self_deduction', $1, '个税本人减除额（旧键，同步用）')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [selfV[1]]);
  }
  if (depV) {
    await query(
      `INSERT INTO sys_config (key, value, label) VALUES ('salary_dependent_deduction', $1, '个税每名抚养人减除额（旧键，同步用）')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [depV[1]]);
  }
  const cfg = await getPitConfig();
  return { ...cfg, updatedBy: userId || null };
}

/** 税率表版本清单（每个生效日一版） */
export async function listTaxBracketVersions() {
  const rows = await many(
    `SELECT v.*, u.real_name AS updated_by_name
       FROM v_tax_bracket_version v
       LEFT JOIN org_user u ON u.id = v.updated_by`
  );
  return rows.map(r => ({
    effectiveFrom: String(r.effective_from).slice(0, 10),
    bracketCount: Number(r.bracket_count),
    firstLower: Number(r.first_lower),
    topRate: Number(r.top_rate),
    topQuick: Number(r.top_quick),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ? Number(r.updated_by) : null,
    updatedByName: r.updated_by_name || null
  }));
}

/** 取一版明细（含备注） */
export async function getTaxBracketVersion(effectiveFrom) {
  const d = String(effectiveFrom || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('生效日期格式应为 YYYY-MM-DD');
  const rows = await many(
    `SELECT seq, lower_bound, rate, quick_deduction, remark
       FROM salary_tax_bracket WHERE effective_from = $1::date ORDER BY lower_bound`,
    [d]
  );
  if (!rows.length) throw Object.assign(new Error('该生效日没有税率表'), { statusCode: 404 });
  return {
    effectiveFrom: d,
    remark: rows[0].remark || null,
    brackets: rows.map(b => ({
      seq: Number(b.seq),
      lower: num(b.lower_bound),
      rate: num(b.rate),
      quick: num(b.quick_deduction)
    }))
  };
}

/**
 * 保存一版税率表（按生效日整版覆盖）。
 * 覆盖而不是追加：同一生效日只应有一版，否则「取最近一版」会随机命中。
 */
export async function saveTaxBracketVersion(data = {}, userId) {
  const d = String(data.effectiveFrom || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('生效日期格式应为 YYYY-MM-DD');
  const today = new Date().toISOString().slice(0, 10);
  if (d < '1900-01-01') throw badRequest('生效日期不合法');

  let rows = normalizeBrackets(data.brackets);
  if (data.autoQuick !== false) rows = suggestQuickDeductions(rows);
  const remark = data.remark ? String(data.remark).slice(0, 500) : null;

  await transaction(async (client) => {
    await client.query(`DELETE FROM salary_tax_bracket WHERE effective_from = $1::date`, [d]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO salary_tax_bracket
           (effective_from, seq, lower_bound, rate, quick_deduction, remark, updated_by, updated_at)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, now())`,
        [d, r.seq, r.lower, r.rate, r.quick, remark, userId || null]
      );
    }
  });
  return {
    ...(await getTaxBracketVersion(d)),
    future: d > today,
    message: d > today
      ? '已保存，将于 ' + d + ' 起生效（当前月份仍按旧版计算）'
      : '已生效。已生成的工资单需要重算才会套用新税率'
  };
}

/** 删除一版（当前或未来生效的那版；最后一版不允许删） */
export async function deleteTaxBracketVersion(effectiveFrom) {
  const d = String(effectiveFrom || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('生效日期格式应为 YYYY-MM-DD');
  const cnt = await one(`SELECT count(DISTINCT effective_from)::int AS n FROM salary_tax_bracket`);
  if (Number(cnt?.n) <= 1) throw badRequest('至少要保留一版税率表，不能删最后一版');
  const r = await query(`DELETE FROM salary_tax_bracket WHERE effective_from = $1::date`, [d]);
  if (!r.rowCount) throw Object.assign(new Error('该生效日没有税率表'), { statusCode: 404 });
  return { ok: true, deleted: Number(r.rowCount) };
}
