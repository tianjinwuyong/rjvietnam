// ============================================================
// 流程台账服务（flow-ledger）
// 职责：按流程 code 聚合台账数据（列定义 + 数据行 + 总数），支持筛选与导出
// 数据来源：flow_instance（表单值）+ flow_execution（闭环）+ flow_definition（列定义）
// ============================================================
import { many, one } from '../db/index.js';

/** 状态归一化：approved→completed，canceled→withdrawn（读取层兼容老数据） */
export const normalizeStatus = (s) =>
  s === 'approved' ? 'completed' : s === 'canceled' ? 'withdrawn' : s;

/** 取某流程的台账列定义（中越双语） */
export async function columns(code) {
  const def = await one(
    `SELECT ledger_columns FROM flow_definition WHERE code = $1`,
    [code]
  );
  return Array.isArray(def?.ledger_columns) ? def.ledger_columns : [];
}

/**
 * 台账查询
 * @param code 流程 code
 * @param filters { from, to, dept, status, keyword, page, size }
 * @param user  当前用户（用于非管理员部门隔离）：{ id, isAdmin, dept_id }
 * @returns { code, name, name_vi, closure_required, columns, list, total, page, size }
 */
export async function query(code, filters = {}, user = null) {
  const { from, to, dept, status, keyword } = filters;
  const page = Math.max(1, Number(filters.page) || 1);
  const size = Math.min(200, Math.max(1, Number(filters.size) || 20));
  const offset = (page - 1) * size;

  const def = await one(
    `SELECT id, code, name, name_vi, closure_required, ledger_columns
       FROM flow_definition WHERE code = $1`,
    [code]
  );
  if (!def) {
    // 语义：资源不存在 → 404（避免以 500 返回业务性「不存在」）
    const err = new Error('流程类型不存在');
    err.statusCode = 404;
    throw err;
  }

  const params = [def.id];
  let where = `i.definition_id = $1`;

  if (from) where += ` AND i.created_at >= $${params.push(from)}::date`;
  if (to) where += ` AND i.created_at < ($${params.push(to)}::date + interval '1 day')`;
  if (status) {
    // 支持七态查询，兼容别名
    params.push(normalizeStatus(status));
    where += ` AND (CASE WHEN i.status IN ('approved') THEN 'completed' WHEN i.status IN ('canceled') THEN 'withdrawn' ELSE i.status END) = $${params.length}`;
  }
  if (dept) {
    params.push(dept);
    where += ` AND d.code = $${params.length}`;
  }
  if (keyword) {
    params.push(`%${keyword}%`);
    where += ` AND (i.title ILIKE $${params.length} OR i.instance_no ILIKE $${params.length} OR i.form_data::text ILIKE $${params.length})`;
  }
  // 部门隔离：非管理员仅看本部门发起或本人经手
  if (user && !user.isAdmin) {
    params.push(user.dept_id || -1, user.id);
    where += ` AND (u.department_id = $${params.length - 1}
                     OR EXISTS (SELECT 1 FROM flow_task t2 WHERE t2.instance_id = i.id AND t2.assignee_id = $${params.length})
                     OR EXISTS (SELECT 1 FROM flow_cc c2 WHERE c2.instance_id = i.id AND c2.user_id = $${params.length}))`;
  }

  const fromSql = `FROM flow_instance i
       JOIN flow_definition fd ON fd.id = i.definition_id
       LEFT JOIN org_user u ON u.id = i.applicant_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE ${where}`;

  const rows = await many(
    `SELECT i.id, i.instance_no, i.title,
            CASE WHEN i.status IN ('approved') THEN 'completed'
                 WHEN i.status IN ('canceled') THEN 'withdrawn'
                 ELSE i.status END AS status,
            i.form_data, i.applicant_id, i.submitted_at, i.finished_at, i.created_at,
            i.closed_loop, i.archived_at,
            u.real_name AS applicant_name, d.name AS dept_name, d.name_en AS dept_name_en, d.code AS dept_code
       ${fromSql}
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT ${size} OFFSET ${offset}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params);

  // 展开台账列值：取 form_data 中对应 key
  const cols = Array.isArray(def.ledger_columns) ? def.ledger_columns : [];
  const list = rows.map(r => {
    const cells = {};
    for (const c of cols) cells[c.key] = r.form_data?.[c.key] ?? null;
    return {
      id: r.id,
      instance_no: r.instance_no,
      title: r.title,
      status: r.status,
      applicant_name: r.applicant_name,
      dept_name: r.dept_name,
      dept_code: r.dept_code,
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      finished_at: r.finished_at,
      archived_at: r.archived_at,
      closed_loop: r.closed_loop,
      cells,
    };
  });

  return {
    code: def.code,
    name: def.name,
    name_vi: def.name_vi,
    closure_required: def.closure_required,
    columns: cols,
    list,
    total: cnt?.n || 0,
    page,
    size,
  };
}

/** 导出数据组装：返回 { columns, rows }，前端据此生成 Excel */
export async function exportRows(code, filters = {}, user = null) {
  const data = await query(code, { ...filters, page: 1, size: 200 }, user);
  const rows = data.list.map(r => {
    const obj = { instance_no: r.instance_no, title: r.title, status: r.status,
      applicant_name: r.applicant_name, dept_name: r.dept_name, created_at: r.created_at };
    for (const c of data.columns) obj[c.key] = r.cells?.[c.key] ?? '';
    return obj;
  });
  return { columns: data.columns, rows };
}

export default { columns, query, exportRows, normalizeStatus };
