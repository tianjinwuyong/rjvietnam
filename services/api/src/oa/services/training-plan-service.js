// ============================================================
// 培训考证服务（岗前 / 在岗培训：计划 + 记录 + 按员工查询）
// ------------------------------------------------------------
// 数据链路：岗位 → 员工(training_plan_member) → 计划(training_plan)
//           → 明细(training_plan_item) → 记录(training_plan_record)
//
// 与旧链路的关系：
//   旧表 training / training_record / staff_certificate（“一场培训 + 一次考试 + 上岗证”）
//   保持原样不动，仍由 modules-service.js 提供 /api/training、/api/certificates。
//   本模块为**新增**能力，独立表、独立路由，绝不影响旧接口。
//
// 记录表冗余存储明细的 5 个业务字段（content/purpose/due_date/assess_method + 越文）：
//   满足用户“培训记录在计划 5 字段基础上增加考核结果、结论”的要求，使记录可独立
//   检索/打印/归档，且计划后续被编辑时历史记录不漂移（快照语义）。
//
// 约定：
//   · 所有写操作由路由层 requirePermission('train:manage') 把关，本层不判管理员；
//   · 业务错误一律 new Error(msg) + err.statusCode，交由统一错误出口透传文案，绝不回显 SQL；
//   · id / 分页参数在路由层用 toId / toInt 归一后再进入本层。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';

/** 允许的培训类型 / 计划状态（白名单） */
const TRAINING_TYPES = new Set(['pre_job', 'on_job']);
const PLAN_STATUSES = new Set(['draft', 'active', 'closed']);

/** 类型 → 编号前缀 */
const TYPE_PREFIX = { pre_job: 'PRE', on_job: 'ON' };

/**
 * 构造业务错误：4xx 状态码 + 明确中文提示，统一错误出口会原样透传文案。
 * @param {string} msg 用户可读提示
 * @param {number} [statusCode=400]
 * @returns {Error}
 */
function bizError(msg, statusCode = 400) {
  const e = new Error(msg);
  e.statusCode = statusCode;
  e.isBiz = true;
  return e;
}

/** 归一培训类型（非法值回退 pre_job） */
function normType(t) {
  return TRAINING_TYPES.has(t) ? t : 'pre_job';
}

/** 归一计划状态（非法值回退 def） */
function normStatus(s, def = 'draft') {
  return PLAN_STATUSES.has(s) ? s : def;
}

/** 归一正文来源（manual 手工 / excel / word） */
function normSourceType(s) {
  return ['manual', 'excel', 'word'].includes(s) ? s : 'manual';
}

/** 仅接受「纯整数」字符串；无法解析返回 null（用于可选 bigint 参数） */
function asId(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** 取服务端当天（yyyy-MM-dd），不依赖 toISOString 的 UTC 偏移 */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 把 DATE（可能为 Date 或字符串）归一为 yyyy-MM-dd 或 null */
function normDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/* ============================================================
 * 一、培训计划
 * ============================================================ */

/**
 * 计划列表（分页）。支持按 培训类型 / 岗位 / 关键字 / 状态 过滤。
 * @param {{trainingType?:string, positionCode?:string, keyword?:string, status?:string,
 *          page?:number, size?:number}} opts
 * @returns {Promise<{list:Array, total:number, page:number, pageSize:number}>}
 */
export async function listPlans({ trainingType, positionCode, keyword, status, page = 1, size = 20 } = {}) {
  const params = [];
  const where = [];
  if (trainingType && TRAINING_TYPES.has(trainingType)) { params.push(trainingType); where.push(`p.training_type = $${params.length}`); }
  if (positionCode) { params.push(positionCode); where.push(`p.position_code = $${params.length}`); }
  if (status && PLAN_STATUSES.has(status)) { params.push(status); where.push(`p.status = $${params.length}`); }
  if (keyword) {
    params.push(`%${keyword}%`);
    where.push(`(p.title ILIKE $${params.length} OR p.plan_no ILIKE $${params.length} OR p.remark ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const cnt = await one(`SELECT COUNT(*)::int AS n FROM training_plan p ${whereSql}`, params);
  const total = cnt?.n || 0;

  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(200, Math.max(1, Number(size) || 20));

  const list = await many(
    `SELECT p.*, u.real_name AS creator_name,
            pos.name_zh AS position_name_zh, pos.name_vi AS position_name_vi,
            (SELECT COUNT(*)::int FROM training_plan_item i WHERE i.plan_id = p.id) AS item_count,
            (SELECT COUNT(*)::int FROM training_plan_member m WHERE m.plan_id = p.id) AS member_count,
            (SELECT COUNT(*)::int FROM training_plan_record r WHERE r.plan_id = p.id) AS record_count,
            (SELECT COUNT(*)::int FROM training_plan_record r
              WHERE r.plan_id = p.id AND r.assess_result IS NOT NULL AND btrim(r.assess_result) <> '') AS result_count
       FROM training_plan p
       LEFT JOIN org_user u ON u.id = p.created_by
       LEFT JOIN sys_i18n_dict pos ON pos.dict_type = 'position' AND pos.code = p.position_code
       ${whereSql}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${s} OFFSET ${(p - 1) * s}`,
    params
  );
  return { list, total, page: p, pageSize: s };
}

/**
 * 计划详情：主表 + 明细行 + 参训员工 + 记录汇总。
 * @param {number} id
 * @returns {Promise<object|null>} 不存在返回 null
 */
export async function getPlan(id) {
  const plan = await one(
    `SELECT p.*, u.real_name AS creator_name,
            pos.name_zh AS position_name_zh, pos.name_vi AS position_name_vi
       FROM training_plan p
       LEFT JOIN org_user u ON u.id = p.created_by
       LEFT JOIN sys_i18n_dict pos ON pos.dict_type = 'position' AND pos.code = p.position_code
      WHERE p.id = $1`,
    [id]
  );
  if (!plan) return null;

  const items = await many(
    `SELECT * FROM training_plan_item WHERE plan_id = $1 ORDER BY seq NULLS LAST, id`,
    [id]
  );
  const members = await many(
    `SELECT m.id AS member_id, m.user_id, u.username, u.employee_no, u.real_name,
            u.position_code, d.name AS dept_name, d.name_en AS dept_name_en,
            (SELECT COUNT(*)::int FROM training_plan_record r
              WHERE r.plan_id = m.plan_id AND r.user_id = m.user_id) AS record_count
       FROM training_plan_member m
       JOIN org_user u ON u.id = m.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE m.plan_id = $1
      ORDER BY u.id`,
    [id]
  );
  return { ...plan, items, members };
}

/**
 * 新建培训计划（含明细行）。计划编号在事务内由 id 序列推导，天然唯一。
 * @param {object} data { trainingType, positionCode, title, titleVi, remark, status, items:[...] }
 * @param {number} userId 创建人
 * @returns {Promise<object>} 计划详情
 */
export async function createPlan(data = {}, userId = null) {
  const title = (data.title || '').trim();
  if (!title) throw bizError('请填写计划名称');

  const trainingType = normType(data.trainingType);
  const status = normStatus(data.status, 'draft');
  const items = Array.isArray(data.items) ? data.items : [];

  const newId = await transaction(async (client) => {
    const r = await client.query(
      `SELECT nextval(pg_get_serial_sequence('training_plan','id'))::bigint AS id`
    );
    const id = Number(r.rows[0].id);
    // 单号与流程单号同口径：<前缀>-<YYMMDD>-<流水>，如 TP-PRE-261106-001
    // （原为 TP-PRE-20261106-0001，8 位日期 + 4 位流水，列表里同样偏长）
    const planNo = `TP-${TYPE_PREFIX[trainingType]}-${todayStr().replace(/-/g, '').slice(2)}-${String(id).padStart(3, '0')}`;
    await client.query(
      `INSERT INTO training_plan (id, plan_no, training_type, position_code, title, title_vi, remark, status, created_by, content_html, source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, planNo, trainingType, data.positionCode || null, title,
        (data.titleVi || '').trim() || null, (data.remark || '').trim() || null, status, userId,
        data.contentHtml || null, normSourceType(data.sourceType)]
    );
    await insertItems(client, id, items);
    return id;
  });

  return getPlan(newId);
}

/**
 * 事务内批量插入明细行（自动补 seq）。
 * @param {import('pg').PoolClient} client
 * @param {number} planId
 * @param {Array} items
 */
async function insertItems(client, planId, items) {
  let auto = 0;
  for (const it of items) {
    auto += 1;
    const seq = Number.isFinite(Number(it.seq)) && Number(it.seq) > 0 ? Number(it.seq) : auto;
    await client.query(
      `INSERT INTO training_plan_item
         (plan_id, seq, content, content_vi, purpose, purpose_vi, due_date, assess_method, assess_method_vi)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [planId, seq,
        (it.content || '').trim() || null, (it.contentVi || '').trim() || null,
        (it.purpose || '').trim() || null, (it.purposeVi || '').trim() || null,
        normDate(it.dueDate), (it.assessMethod || '').trim() || null, (it.assessMethodVi || '').trim() || null]
    );
  }
}

/**
 * 编辑培训计划（含明细行同步）。
 * 明细同步策略：带 id 且属于本计划的 → 更新；无 id → 新增；
 *   原明细中未提交的 → 无培训记录引用时删除，否则保留（避免级联删掉历史记录）。
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>} 计划详情
 */
export async function updatePlan(id, data = {}) {
  const cur = await one(`SELECT * FROM training_plan WHERE id = $1`, [id]);
  if (!cur) throw bizError('培训计划不存在', 404);

  const title = data.title === undefined ? cur.title : String(data.title || '').trim();
  if (!title) throw bizError('请填写计划名称');

  const trainingType = data.trainingType === undefined ? cur.training_type : normType(data.trainingType);
  const status = data.status === undefined ? cur.status : normStatus(data.status, cur.status);
  const positionCode = data.positionCode === undefined ? cur.position_code : (data.positionCode || null);
  const titleVi = data.titleVi === undefined ? cur.title_vi : ((data.titleVi || '').trim() || null);
  const remark = data.remark === undefined ? cur.remark : ((data.remark || '').trim() || null);

  await transaction(async (client) => {
    await client.query(
      `UPDATE training_plan
          SET training_type = $2, position_code = $3, title = $4, title_vi = $5,
              remark = $6, status = $7, content_html = $8, source_type = $9, updated_at = now()
        WHERE id = $1`,
      [id, trainingType, positionCode, title, titleVi, remark, status,
        data.contentHtml === undefined ? cur.content_html : (data.contentHtml || null),
        data.sourceType === undefined ? cur.source_type : normSourceType(data.sourceType)]
    );

    if (Array.isArray(data.items)) {
      const existRes = await client.query(`SELECT id FROM training_plan_item WHERE plan_id = $1`, [id]);
      const existingIds = existRes.rows.map(r => Number(r.id));
      const keepIds = new Set();
      let auto = 0;
      for (const it of data.items) {
        auto += 1;
        const seq = Number.isFinite(Number(it.seq)) && Number(it.seq) > 0 ? Number(it.seq) : auto;
        const itemId = asId(it.id);
        if (itemId && existingIds.includes(itemId)) {
          keepIds.add(itemId);
          await client.query(
            `UPDATE training_plan_item
                SET seq = $2, content = $3, content_vi = $4, purpose = $5, purpose_vi = $6,
                    due_date = $7, assess_method = $8, assess_method_vi = $9, updated_at = now()
              WHERE id = $1 AND plan_id = $10`,
            [itemId, seq,
              (it.content || '').trim() || null, (it.contentVi || '').trim() || null,
              (it.purpose || '').trim() || null, (it.purposeVi || '').trim() || null,
              normDate(it.dueDate), (it.assessMethod || '').trim() || null, (it.assessMethodVi || '').trim() || null,
              id]
          );
        } else {
          await client.query(
            `INSERT INTO training_plan_item
               (plan_id, seq, content, content_vi, purpose, purpose_vi, due_date, assess_method, assess_method_vi)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [id, seq,
              (it.content || '').trim() || null, (it.contentVi || '').trim() || null,
              (it.purpose || '').trim() || null, (it.purposeVi || '').trim() || null,
              normDate(it.dueDate), (it.assessMethod || '').trim() || null, (it.assessMethodVi || '').trim() || null]
          );
        }
      }
      // 删除未提交且无记录引用的旧明细；有记录引用的保留，保护历史记录
      for (const exId of existingIds) {
        if (keepIds.has(exId)) continue;
        const ref = await client.query(
          `SELECT 1 FROM training_plan_record WHERE item_id = $1 LIMIT 1`, [exId]
        );
        if (ref.rowCount === 0) {
          await client.query(`DELETE FROM training_plan_item WHERE id = $1 AND plan_id = $2`, [exId, id]);
        }
      }
    }
  });

  return getPlan(id);
}

/**
 * 删除计划（级联删除明细/名单/记录）。
 * @param {number} id
 * @returns {Promise<{id:number}>}
 */
export async function deletePlan(id) {
  const cur = await one(`SELECT id FROM training_plan WHERE id = $1`, [id]);
  if (!cur) throw bizError('培训计划不存在', 404);
  await query(`DELETE FROM training_plan WHERE id = $1`, [id]);
  return { id };
}

/* ============================================================
 * 二、计划适用员工（按岗位导入）
 * ============================================================ */

/**
 * 按岗位 / 员工列表 / 部门(工段) 批量导入参训员工（幂等：已在名单内自动跳过）。
 *
 * 入参优先级（互斥）：**userIds > departmentIds > positionCode**
 *   · userIds        显式员工 id 列表（精确指定）
 *   · departmentIds  部门(工段) id 列表 —— 「工段=部门」，取这些部门下的在职员工（去重）
 *   · positionCode   岗位编码 —— 保留既有通路，勿破坏
 * 返回结构保持不变：{ added, skipped, total }。
 *
 * @param {number} planId
 * @param {{positionCode?:string, userIds?:Array<number|string>, departmentIds?:Array<number|string>}} opts
 * @returns {Promise<{added:number, skipped:number, total:number}>}
 */
export async function importMembers(planId, { positionCode, userIds, departmentIds } = {}) {
  const plan = await one(`SELECT id FROM training_plan WHERE id = $1`, [planId]);
  if (!plan) throw bizError('培训计划不存在', 404);

  const deptIds = [...new Set((Array.isArray(departmentIds) ? departmentIds : []).map(asId).filter(x => x !== null))];

  let candidateIds = [];
  if (Array.isArray(userIds) && userIds.length) {
    const ids = [...new Set(userIds.map(asId).filter(x => x !== null))];
    if (!ids.length) throw bizError('员工列表为空或格式不正确');
    const rows = await many(`SELECT id FROM org_user WHERE id = ANY($1::bigint[])`, [ids]);
    candidateIds = rows.map(r => Number(r.id));
  } else if (deptIds.length) {
    const rows = await many(
      `SELECT id FROM org_user WHERE department_id = ANY($1::bigint[]) AND active = TRUE ORDER BY id`,
      [deptIds]
    );
    // SELECT 已天然去重（一个员工只属一个部门），此处 DISTINCT 兜底
    candidateIds = [...new Set(rows.map(r => Number(r.id)))];
    if (!candidateIds.length) throw bizError('所选工段下没有在职员工');
  } else if (positionCode) {
    const rows = await many(
      `SELECT id FROM org_user WHERE position_code = $1 AND active = TRUE ORDER BY id`,
      [positionCode]
    );
    candidateIds = rows.map(r => Number(r.id));
    if (!candidateIds.length) throw bizError(`岗位「${positionCode}」下没有在职员工`);
  } else {
    throw bizError('请提供岗位编码（positionCode）、工段（departmentIds）或员工列表（userIds）');
  }

  let added = 0;
  for (const uid of candidateIds) {
    const r = await query(
      `INSERT INTO training_plan_member (plan_id, user_id) VALUES ($1,$2)
       ON CONFLICT (plan_id, user_id) DO NOTHING`,
      [planId, uid]
    );
    added += r.rowCount;
  }
  return { added, skipped: candidateIds.length - added, total: candidateIds.length };
}

/**
 * 预检：按岗位返回将被导入的员工（不落库，供前端「预览」）。
 * @param {{positionCode?:string}} opts
 * @returns {Promise<Array>}
 */
export async function previewMembersByPosition({ positionCode } = {}) {
  if (!positionCode) throw bizError('请提供岗位编码');
  return many(
    `SELECT u.id, u.username, u.employee_no, u.real_name, u.position_code,
            d.name AS dept_name, d.name_en AS dept_name_en
       FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE u.position_code = $1 AND u.active = TRUE
      ORDER BY u.id`,
    [positionCode]
  );
}

/**
 * 预检：按**多个部门(工段) id** 返回将被导入的员工（不落库，含 dept_name）。
 * 返回结构与 previewMembersByPosition 对齐（同一批字段），供前端「按工段」页签预览。
 *
 * @param {Array<number|string>} deptIds 部门/工段 id 列表
 * @returns {Promise<Array>}
 */
export async function previewMembersByDepartments(deptIds = []) {
  const ids = [...new Set((Array.isArray(deptIds) ? deptIds : []).map(asId).filter(x => x !== null))];
  if (!ids.length) throw bizError('请提供工段（departmentIds）');
  return many(
    `SELECT u.id, u.username, u.employee_no, u.real_name, u.position_code,
            d.name AS dept_name, d.name_en AS dept_name_en
       FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE u.department_id = ANY($1::bigint[]) AND u.active = TRUE
      ORDER BY u.id`,
    [ids]
  );
}

/**
 * 从计划名单移除员工。
 * @param {number} planId
 * @param {Array<number|string>} userIds
 * @returns {Promise<{removed:number}>}
 */
export async function removeMembers(planId, userIds = []) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(asId).filter(x => x !== null))];
  if (!ids.length) throw bizError('请选择要移除的员工');
  const r = await query(
    `DELETE FROM training_plan_member WHERE plan_id = $1 AND user_id = ANY($2::bigint[])`,
    [planId, ids]
  );
  return { removed: r.rowCount };
}

/* ============================================================
 * 三、培训记录（按人 × 明细生成 / 录入 / 更新）
 * ============================================================ */

/**
 * 为计划的（成员 × 明细）补齐空记录（幂等：已存在的跳过）。
 * 记录会快照明细的 5 个业务字段，之后逐条录入考核结果/结论。
 * @param {number} planId
 * @param {{userIds?:Array}} [opts]
 * @returns {Promise<{created:number, skipped:number, itemCount:number, memberCount:number}>}
 */
export async function generateRecords(planId, { userIds } = {}) {
  const plan = await one(`SELECT id FROM training_plan WHERE id = $1`, [planId]);
  if (!plan) throw bizError('培训计划不存在', 404);

  const items = await many(
    `SELECT * FROM training_plan_item WHERE plan_id = $1 ORDER BY seq NULLS LAST, id`, [planId]
  );
  if (!items.length) throw bizError('请先为计划添加培训明细');

  let memberRows;
  const filterIds = [...new Set((Array.isArray(userIds) ? userIds : []).map(asId).filter(x => x !== null))];
  if (filterIds.length) {
    memberRows = await many(
      `SELECT user_id FROM training_plan_member WHERE plan_id = $1 AND user_id = ANY($2::bigint[])`,
      [planId, filterIds]
    );
  } else {
    memberRows = await many(`SELECT user_id FROM training_plan_member WHERE plan_id = $1`, [planId]);
  }
  if (!memberRows.length) throw bizError('请先为计划导入参训员工');

  let created = 0;
  let skipped = 0;
  for (const m of memberRows) {
    const uid = Number(m.user_id);
    for (const it of items) {
      const r = await query(
        `INSERT INTO training_plan_record
           (plan_id, item_id, user_id, seq, content, content_vi, purpose, purpose_vi,
            due_date, assess_method, assess_method_vi, record_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (plan_id, item_id, user_id) DO NOTHING`,
        [planId, Number(it.id), uid, it.seq, it.content, it.content_vi, it.purpose, it.purpose_vi,
          normDate(it.due_date), it.assess_method, it.assess_method_vi, todayStr()]
      );
      created += r.rowCount;
      if (r.rowCount === 0) skipped += 1;
    }
  }
  return { created, skipped, itemCount: items.length, memberCount: memberRows.length };
}

/**
 * 记录列表（分页）。支持按 员工 / 计划 / 类型 / 岗位 / 关键字 / 计划完成时间 过滤。
 * @param {{userId?:number, planId?:number, trainingType?:string, positionCode?:string,
 *          keyword?:string, from?:string, to?:string, page?:number, size?:number}} opts
 * @returns {Promise<{list:Array, total:number, page:number, pageSize:number}>}
 */
export async function listRecords({
  userId, planId, trainingType, positionCode, keyword, from, to, page = 1, size = 20,
} = {}) {
  const params = [];
  const where = [];
  if (userId) { params.push(userId); where.push(`r.user_id = $${params.length}`); }
  if (planId) { params.push(planId); where.push(`r.plan_id = $${params.length}`); }
  if (trainingType && TRAINING_TYPES.has(trainingType)) { params.push(trainingType); where.push(`p.training_type = $${params.length}`); }
  if (positionCode) { params.push(positionCode); where.push(`u.position_code = $${params.length}`); }
  if (from) { params.push(from); where.push(`r.due_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`r.due_date <= $${params.length}`); }
  if (keyword) {
    params.push(`%${keyword}%`);
    where.push(`(u.real_name ILIKE $${params.length} OR u.username ILIKE $${params.length}
                 OR p.title ILIKE $${params.length} OR r.content ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const cnt = await one(
    `SELECT COUNT(*)::int AS n
       FROM training_plan_record r
       JOIN training_plan p ON p.id = r.plan_id
       JOIN org_user u ON u.id = r.user_id
       ${whereSql}`,
    params
  );
  const total = cnt?.n || 0;

  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(500, Math.max(1, Number(size) || 20));

  const list = await many(
    `SELECT r.*, p.title AS plan_title, p.title_vi AS plan_title_vi, p.plan_no,
            p.training_type, p.position_code AS plan_position_code,
            u.real_name, u.username, u.employee_no, u.position_code,
            d.name AS dept_name, d.name_en AS dept_name_en, rec.real_name AS recorder_name
       FROM training_plan_record r
       JOIN training_plan p ON p.id = r.plan_id
       JOIN org_user u ON u.id = r.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN org_user rec ON rec.id = r.recorder_id
       ${whereSql}
      ORDER BY p.training_type, r.due_date NULLS LAST, r.seq NULLS LAST, r.id
      LIMIT ${s} OFFSET ${(p - 1) * s}`,
    params
  );
  return { list, total, page: p, pageSize: s };
}

/**
 * 按员工查询其全部培训记录（核心需求）。
 * @param {number} userId
 * @param {{trainingType?:string, from?:string, to?:string, page?:number, size?:number}} [opts]
 * @returns {Promise<{user:object|null, list:Array, total:number, page:number, pageSize:number, summary:object}>}
 */
export async function listRecordsByUser(userId, { trainingType, from, to, page = 1, size = 100 } = {}) {
  const user = await one(
    `SELECT u.id, u.username, u.employee_no, u.real_name, u.position_code, u.position,
            d.name AS dept_name, d.name_en AS dept_name_en, pos.name_zh AS position_name_zh, pos.name_vi AS position_name_vi
       FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN sys_i18n_dict pos ON pos.dict_type = 'position' AND pos.code = u.position_code
      WHERE u.id = $1`,
    [userId]
  );
  if (!user) throw bizError('员工不存在', 404);

  const result = await listRecords({ userId, trainingType, from, to, page, size });

  const summaryRows = await many(
    `SELECT p.training_type, COUNT(*)::int AS n
       FROM training_plan_record r
       JOIN training_plan p ON p.id = r.plan_id
      WHERE r.user_id = $1
      GROUP BY p.training_type`,
    [userId]
  );
  const summary = { pre_job: 0, on_job: 0, total: 0 };
  for (const row of summaryRows) {
    summary[row.training_type] = row.n;
    summary.total += row.n;
  }
  return { user, ...result, summary };
}

/**
 * 更新单条培训记录（考核结果 / 结论 / 记录日期 / 备注，可选覆盖 5 字段快照）。
 * @param {number} id
 * @param {object} data
 * @param {number} operatorId 记录人（一般取当前登录用户）
 * @returns {Promise<object>}
 */
export async function updateRecord(id, data = {}, operatorId = null) {
  const cur = await one(`SELECT * FROM training_plan_record WHERE id = $1`, [id]);
  if (!cur) throw bizError('培训记录不存在', 404);

  const pick = (key, col) => (data[key] === undefined ? cur[col] : ((data[key] === null) ? null : String(data[key])));
  const content = pick('content', 'content');
  const contentVi = pick('contentVi', 'content_vi');
  const purpose = pick('purpose', 'purpose');
  const purposeVi = pick('purposeVi', 'purpose_vi');
  const assessMethod = pick('assessMethod', 'assess_method');
  const assessMethodVi = pick('assessMethodVi', 'assess_method_vi');
  const assessResult = pick('assessResult', 'assess_result');
  const conclusion = pick('conclusion', 'conclusion');
  const remark = pick('remark', 'remark');
  const dueDate = data.dueDate === undefined ? cur.due_date : normDate(data.dueDate);
  const recordDate = data.recordDate === undefined ? cur.record_date : normDate(data.recordDate);
  const seq = data.seq === undefined ? cur.seq : (data.seq === null ? null : Number(data.seq) || null);

  const r = await one(
    `UPDATE training_plan_record
        SET seq = $2, content = $3, content_vi = $4, purpose = $5, purpose_vi = $6,
            due_date = $7, assess_method = $8, assess_method_vi = $9,
            assess_result = $10, conclusion = $11, record_date = $12, remark = $13,
            recorder_id = COALESCE($14, recorder_id), updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, seq, content, contentVi, purpose, purposeVi, dueDate, assessMethod, assessMethodVi,
      assessResult, conclusion, recordDate, remark, operatorId]
  );
  return r;
}

/**
 * 批量录入 / 更新培训记录。
 * 每条：带 id → 更新；否则按 (planId,itemId,userId) 不存在则创建空记录再更新。
 * @param {Array<object>} records
 * @param {number} operatorId
 * @returns {Promise<{updated:number, created:number, failed:Array<{index:number,msg:string}>}>}
 */
export async function saveRecordsBatch(records = [], operatorId = null) {
  if (!Array.isArray(records) || !records.length) throw bizError('没有要保存的记录');
  let updated = 0;
  let created = 0;
  const failed = [];

  for (let i = 0; i < records.length; i++) {
    const item = records[i] || {};
    try {
      let recId = asId(item.id);
      if (!recId) {
        const planId = asId(item.planId);
        const itemId = asId(item.itemId);
        const userId = asId(item.userId);
        if (!planId || !itemId || !userId) {
          failed.push({ index: i, msg: '缺少 planId / itemId / userId' });
          continue;
        }
        const it = await one(
          `SELECT seq, content, content_vi, purpose, purpose_vi, due_date, assess_method, assess_method_vi
             FROM training_plan_item WHERE id = $1 AND plan_id = $2`,
          [itemId, planId]
        );
        if (!it) { failed.push({ index: i, msg: '培训明细不存在' }); continue; }
        const ins = await one(
          `INSERT INTO training_plan_record
             (plan_id, item_id, user_id, seq, content, content_vi, purpose, purpose_vi,
              due_date, assess_method, assess_method_vi, record_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (plan_id, item_id, user_id) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [planId, itemId, userId, it.seq, it.content, it.content_vi, it.purpose, it.purpose_vi,
            normDate(it.due_date), it.assess_method, it.assess_method_vi, todayStr()]
        );
        recId = Number(ins.id);
        created += 1;
      }
      await updateRecord(recId, item, operatorId);
      updated += 1;
    } catch (err) {
      failed.push({ index: i, msg: err?.message || '保存失败' });
    }
  }
  return { updated, created, failed };
}

/**
 * 删除单条培训记录。
 * @param {number} id
 * @returns {Promise<{id:number}>}
 */
export async function deleteRecord(id) {
  const cur = await one(`SELECT id FROM training_plan_record WHERE id = $1`, [id]);
  if (!cur) throw bizError('培训记录不存在', 404);
  await query(`DELETE FROM training_plan_record WHERE id = $1`, [id]);
  return { id };
}

/* ============================================================
 * 四、导出（返回 {columns, rows, sheetName, fileName}，前端用 xlsx 生成文件）
 * ============================================================ */

/** 培训记录导出列（中越双语表头） */
const RECORD_COLUMNS = [
  { key: 'employee_no', label: '工号', label_vi: 'Mã nhân viên' },
  { key: 'real_name', label: '姓名', label_vi: 'Họ tên' },
  { key: 'dept_name', label: '部门', label_vi: 'Bộ phận' },
  { key: 'position_name', label: '岗位', label_vi: 'Vị trí' },
  { key: 'plan_title', label: '所属计划', label_vi: 'Kế hoạch' },
  { key: 'training_type', label: '培训类型', label_vi: 'Loại đào tạo' },
  { key: 'seq', label: '序号', label_vi: 'Số thứ tự' },
  { key: 'content', label: '培训内容', label_vi: 'Nội dung đào tạo' },
  { key: 'purpose', label: '培训目的及要求', label_vi: 'Mục đích và yêu cầu' },
  { key: 'due_date', label: '计划完成时间', label_vi: 'Thời hạn hoàn thành' },
  { key: 'assess_method', label: '考核方式', label_vi: 'Hình thức đánh giá' },
  { key: 'assess_result', label: '考核结果', label_vi: 'Kết quả đánh giá' },
  { key: 'conclusion', label: '结论', label_vi: 'Kết luận' },
  { key: 'record_date', label: '记录日期', label_vi: 'Ngày ghi nhận' },
  { key: 'recorder_name', label: '记录人', label_vi: 'Người ghi nhận' },
];

/** 培训计划（明细）导出列 */
const PLAN_COLUMNS = [
  { key: 'seq', label: '序号', label_vi: 'Số thứ tự' },
  { key: 'content', label: '培训内容', label_vi: 'Nội dung đào tạo' },
  { key: 'purpose', label: '培训目的及要求', label_vi: 'Mục đích và yêu cầu' },
  { key: 'due_date', label: '计划完成时间', label_vi: 'Thời hạn hoàn thành' },
  { key: 'assess_method', label: '考核方式', label_vi: 'Hình thức đánh giá' },
  { key: 'members', label: '参训员工', label_vi: 'Nhân viên tham gia' },
];

/**
 * 导出单个培训计划（明细表，含参训员工名单）。
 * @param {number} planId
 * @returns {Promise<{columns:Array, rows:Array, sheetName:string, fileName:string}>}
 */
export async function planExport(planId) {
  const plan = await getPlan(planId);
  if (!plan) throw bizError('培训计划不存在', 404);
  const memberNames = (plan.members || [])
    .map(m => m.real_name || m.username || `#${m.user_id}`)
    .join('、');
  const rows = (plan.items || []).map(it => ({
    seq: it.seq,
    content: it.content || '',
    purpose: it.purpose || '',
    due_date: normDate(it.due_date) || '',
    assess_method: it.assess_method || '',
    members: memberNames,
  }));
  const safeNo = String(plan.plan_no || planId).replace(/[^\w-]/g, '');
  return {
    columns: PLAN_COLUMNS,
    rows,
    sheetName: 'training-plan',
    fileName: `training-plan-${safeNo}.xlsx`,
  };
}

/**
 * 导出培训记录表。支持与列表一致的过滤条件；传 userId 时该员工全部记录。
 * @param {{userId?:number, planId?:number, trainingType?:string, positionCode?:string,
 *          keyword?:string, from?:string, to?:string}} opts
 * @returns {Promise<{columns:Array, rows:Array, sheetName:string, fileName:string}>}
 */
export async function recordsExport(opts = {}) {
  // 用大 size 一次取全（导出场景数据量可控）
  const { list } = await listRecords({ ...opts, page: 1, size: 5000 });
  const typeLabel = (t) => (t === 'on_job' ? '在岗培训 / Đào tạo tại chức' : '岗前培训 / Đào tạo trước khi làm việc');
  const rows = (list || []).map(r => ({
    employee_no: r.employee_no || '',
    real_name: r.real_name || '',
    dept_name: r.dept_name || '',
    position_name: r.position_name || r.position_code || '',
    plan_title: r.plan_title || '',
    training_type: typeLabel(r.training_type),
    seq: r.seq ?? '',
    content: r.content || '',
    purpose: r.purpose || '',
    due_date: normDate(r.due_date) || '',
    assess_method: r.assess_method || '',
    assess_result: r.assess_result || '',
    conclusion: r.conclusion || '',
    record_date: normDate(r.record_date) || '',
    recorder_name: r.recorder_name || '',
  }));
  const day = todayStr();
  const suffix = opts.userId ? `-user${opts.userId}` : '';
  return {
    columns: RECORD_COLUMNS,
    rows,
    sheetName: 'training-records',
    fileName: `training-records${suffix}-${day}.xlsx`,
  };
}
