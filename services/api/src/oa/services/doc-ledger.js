// ============================================================
// 体系文件台账服务（doc-ledger）
// 职责：7 类台账的列定义（中越双语表头）+ 数据聚合 + 导出组装
// 参照 flow-ledger.js 模式：返回 {columns, rows}，前端按登录语言生成 Excel。
// 7 类（§6）：controlled / issue / obsolete / destroy / borrow / external / review
// ============================================================
import { many, one } from '../db/index.js';

/** 7 类台账列定义（key + 中越表头），全部为 JSON 结构，导出时按 lang 选表头 */
export const LEDGER_DEFS = {
  controlled: {
    label: '受控文件总览', labelVi: 'Tổng quan tài liệu kiểm soát',
    columns: [
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'title', label: '文件名称', label_vi: 'Tên tài liệu' },
      { key: 'category', label: '分类', label_vi: 'Phân loại' },
      { key: 'security_level', label: '密级', label_vi: 'Mức mật' },
      { key: 'current_version', label: '版本', label_vi: 'Phiên bản' },
      { key: 'owner_dept', label: '责任部门', label_vi: 'Bộ phận' },
      { key: 'status', label: '状态', label_vi: 'Trạng thái' },
      { key: 'issue_date', label: '发行日期', label_vi: 'Ngày ban hành' },
      { key: 'next_review_date', label: '下次评审', label_vi: 'Lần thẩm định sau' },
    ],
  },
  issue: {
    label: '发放回收记录', labelVi: 'Ghi nhận cấp phát thu hồi',
    columns: [
      { key: 'record_type', label: '记录类型', label_vi: 'Loại ghi nhận' },
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'version', label: '版本', label_vi: 'Phiên bản' },
      { key: 'dept_name', label: '部门', label_vi: 'Bộ phận' },
      { key: 'holder_name', label: '持有人', label_vi: 'Người giữ' },
      { key: 'copies', label: '份数', label_vi: 'Số bản' },
      { key: 'operate_date', label: '操作日期', label_vi: 'Ngày thao tác' },
      { key: 'operator_name', label: '操作人', label_vi: 'Người thao tác' },
      { key: 'reason', label: '原因', label_vi: 'Lý do' },
    ],
  },
  obsolete: {
    label: '作废清单', labelVi: 'Danh sách hủy bỏ',
    columns: [
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'title', label: '文件名称', label_vi: 'Tên tài liệu' },
      { key: 'version', label: '作废版本', label_vi: 'Phiên bản hủy' },
      { key: 'obsolete_date', label: '作废日期', label_vi: 'Ngày hủy' },
      { key: 'reason', label: '作废原因', label_vi: 'Lý do hủy' },
      { key: 'code_state', label: '编号状态', label_vi: 'Trạng thái mã' },
    ],
  },
  destroy: {
    label: '销毁记录', labelVi: 'Ghi nhận tiêu hủy',
    columns: [
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'version', label: '版本', label_vi: 'Phiên bản' },
      { key: 'destroy_method', label: '销毁方式', label_vi: 'Cách tiêu hủy' },
      { key: 'destroy_date', label: '销毁日期', label_vi: 'Ngày tiêu hủy' },
      { key: 'destroy_by_name', label: '销毁人', label_vi: 'Người tiêu hủy' },
      { key: 'remark', label: '备注', label_vi: 'Ghi chú' },
    ],
  },
  borrow: {
    label: '借阅登记', labelVi: 'Đăng ký mượn',
    columns: [
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'version', label: '版本', label_vi: 'Phiên bản' },
      { key: 'borrower_name', label: '借阅人', label_vi: 'Người mượn' },
      { key: 'purpose', label: '借阅用途', label_vi: 'Mục đích' },
      { key: 'borrow_date', label: '借阅日期', label_vi: 'Ngày mượn' },
      { key: 'expect_return_date', label: '应还日期', label_vi: 'Ngày phải trả' },
      { key: 'return_date', label: '归还日期', label_vi: 'Ngày trả' },
      { key: 'status', label: '状态', label_vi: 'Trạng thái' },
    ],
  },
  external: {
    label: '外来文件清单', labelVi: 'Danh sách tài liệu bên ngoài',
    columns: [
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'title', label: '文件名称', label_vi: 'Tên tài liệu' },
      { key: 'source_org', label: '来源单位', label_vi: 'Đơn vị nguồn' },
      { key: 'source_no', label: '原始编号', label_vi: 'Mã gốc' },
      { key: 'receive_date', label: '收文日期', label_vi: 'Ngày nhận' },
      { key: 'last_review_quarter', label: '最近评审季度', label_vi: 'Quý thẩm định gần nhất' },
      { key: 'review_result', label: '评审结果', label_vi: 'Kết quả' },
    ],
  },
  review: {
    label: '评审记录', labelVi: 'Ghi nhận thẩm định',
    columns: [
      { key: 'code', label: '文件编号', label_vi: 'Mã tài liệu' },
      { key: 'review_type', label: '评审类型', label_vi: 'Loại thẩm định' },
      { key: 'plan_date', label: '计划日期', label_vi: 'Ngày kế hoạch' },
      { key: 'done_date', label: '完成日期', label_vi: 'Ngày hoàn thành' },
      { key: 'conclusion', label: '评审结论', label_vi: 'Kết luận' },
      { key: 'reviewer_name', label: '评审人', label_vi: 'Người thẩm định' },
      { key: 'remark', label: '备注', label_vi: 'Ghi chú' },
    ],
  },
};

/** 台账类型是否合法 */
export function isValidLedgerType(type) {
  return Object.prototype.hasOwnProperty.call(LEDGER_DEFS, type);
}

/** 取某台账列定义 */
export function columns(type) {
  const def = LEDGER_DEFS[type];
  if (!def) throw new Error('台账类型不存在');
  return def.columns;
}

/** 通用分页参数归一化 */
function pageArgs(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const size = Math.min(500, Math.max(1, Number(filters.size) || 20));
  return { page, size, offset: (page - 1) * size };
}

/**
 * 台账查询（按类型分派到各自 SQL）。
 * @returns { type, label, labelVi, columns, list, total, page, size }
 */
export async function query(type, filters = {}) {
  if (!isValidLedgerType(type)) throw new Error('台账类型不存在');
  const def = LEDGER_DEFS[type];
  const { page, size, offset } = pageArgs(filters);
  let list = [];
  let total = 0;

  if (type === 'controlled') {
    const params = [];
    let where = '1=1';
    if (filters.status) { params.push(filters.status); where += ` AND d.status = $${params.length}`; }
    if (filters.dept) { params.push(filters.dept); where += ` AND dep.code = $${params.length}`; }
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND (d.title ILIKE $${params.length} OR d.code ILIKE $${params.length})`; }
    if (filters.from) { params.push(filters.from); where += ` AND d.issue_date >= $${params.length}::date`; }
    if (filters.to) { params.push(filters.to); where += ` AND d.issue_date <= $${params.length}::date`; }
    const fromSql = `FROM doc_system d LEFT JOIN org_department dep ON dep.id = d.owner_dept_id WHERE ${where}`;
    list = await many(
      `SELECT d.code, d.title, d.category, d.security_level, d.current_version, d.status,
              d.issue_date, d.next_review_date, dep.name AS owner_dept ${fromSql}
       ORDER BY d.updated_at DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  } else if (type === 'issue') {
    const params = [];
    let where = '1=1';
    if (filters.dept) { params.push(filters.dept); where += ` AND dep.code = $${params.length}`; }
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND d.code ILIKE $${params.length}`; }
    if (filters.from) { params.push(filters.from); where += ` AND r.operate_date >= $${params.length}::date`; }
    if (filters.to) { params.push(filters.to); where += ` AND r.operate_date <= $${params.length}::date`; }
    const fromSql = `FROM doc_issue_record r
       JOIN doc_system d ON d.id = r.doc_id
       LEFT JOIN org_department dep ON dep.id = r.dept_id
       LEFT JOIN org_user h ON h.id = r.holder_id
       LEFT JOIN org_user o ON o.id = r.operator_id
      WHERE ${where}`;
    list = await many(
      `SELECT r.record_type, d.code, r.version, dep.name AS dept_name, dep.name_en AS dept_name_en, h.real_name AS holder_name,
              r.copies, r.operate_date, o.real_name AS operator_name, r.reason ${fromSql}
       ORDER BY r.operate_date DESC, r.id DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  } else if (type === 'obsolete') {
    const params = [];
    let where = '1=1';
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND (d.title ILIKE $${params.length} OR d.code ILIKE $${params.length})`; }
    if (filters.from) { params.push(filters.from); where += ` AND o.obsolete_date >= $${params.length}::date`; }
    if (filters.to) { params.push(filters.to); where += ` AND o.obsolete_date <= $${params.length}::date`; }
    const fromSql = `FROM doc_obsolete_record o JOIN doc_system d ON d.id = o.doc_id WHERE ${where}`;
    list = await many(
      `SELECT d.code, d.title, o.version, o.obsolete_date, o.reason, d.code_state ${fromSql}
       ORDER BY o.obsolete_date DESC, o.id DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  } else if (type === 'destroy') {
    const params = [];
    let where = `o.destroy_status = 'destroyed'`;
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND d.code ILIKE $${params.length}`; }
    if (filters.from) { params.push(filters.from); where += ` AND o.destroy_date >= $${params.length}::date`; }
    if (filters.to) { params.push(filters.to); where += ` AND o.destroy_date <= $${params.length}::date`; }
    const fromSql = `FROM doc_obsolete_record o
       JOIN doc_system d ON d.id = o.doc_id
       LEFT JOIN org_user u ON u.id = o.destroy_by
      WHERE ${where}`;
    list = await many(
      `SELECT d.code, o.version, o.destroy_method, o.destroy_date, u.real_name AS destroy_by_name,
              o.reason AS remark ${fromSql}
       ORDER BY o.destroy_date DESC, o.id DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  } else if (type === 'borrow') {
    const params = [];
    let where = '1=1';
    if (filters.status) { params.push(filters.status); where += ` AND b.status = $${params.length}`; }
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND d.code ILIKE $${params.length}`; }
    if (filters.from) { params.push(filters.from); where += ` AND b.borrow_date >= $${params.length}::date`; }
    if (filters.to) { params.push(filters.to); where += ` AND b.borrow_date <= $${params.length}::date`; }
    const fromSql = `FROM doc_borrow_record b
       JOIN doc_system d ON d.id = b.doc_id
       LEFT JOIN org_user u ON u.id = b.borrower_id
      WHERE ${where}`;
    list = await many(
      `SELECT d.code, b.version, u.real_name AS borrower_name, b.purpose, b.borrow_date,
              b.expect_return_date, b.return_date, b.status ${fromSql}
       ORDER BY b.borrow_date DESC, b.id DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  } else if (type === 'external') {
    const params = [];
    let where = `d.category = 'external'`;
    if (filters.quarter) { params.push(filters.quarter); where += ` AND e.last_review_quarter = $${params.length}`; }
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND (d.title ILIKE $${params.length} OR d.code ILIKE $${params.length})`; }
    const fromSql = `FROM doc_system d
       LEFT JOIN doc_external_record e ON e.doc_id = d.id
      WHERE ${where}`;
    list = await many(
      `SELECT d.code, d.title, COALESCE(e.source_org, d.external_source) AS source_org,
              COALESCE(e.source_no, d.external_no) AS source_no,
              e.receive_date, e.last_review_quarter, e.review_result ${fromSql}
       ORDER BY d.updated_at DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  } else if (type === 'review') {
    const params = [];
    let where = '1=1';
    if (filters.reviewType) { params.push(filters.reviewType); where += ` AND rv.review_type = $${params.length}`; }
    if (filters.keyword) { params.push(`%${filters.keyword}%`); where += ` AND d.code ILIKE $${params.length}`; }
    if (filters.from) { params.push(filters.from); where += ` AND rv.plan_date >= $${params.length}::date`; }
    if (filters.to) { params.push(filters.to); where += ` AND rv.plan_date <= $${params.length}::date`; }
    const fromSql = `FROM doc_review_record rv
       JOIN doc_system d ON d.id = rv.doc_id
       LEFT JOIN org_user u ON u.id = rv.reviewer_id
      WHERE ${where}`;
    list = await many(
      `SELECT d.code, rv.review_type, rv.plan_date, rv.done_date, rv.conclusion,
              u.real_name AS reviewer_name, rv.remark ${fromSql}
       ORDER BY rv.plan_date DESC NULLS LAST, rv.id DESC LIMIT ${size} OFFSET ${offset}`, params);
    total = (await one(`SELECT COUNT(*)::int AS n ${fromSql}`, params))?.n || 0;
  }

  return { type, label: def.label, labelVi: def.labelVi, columns: def.columns, list, total, page, size };
}

/** 导出组装：{columns, rows}（前端按 lang 生成表头） */
export async function exportRows(type, filters = {}) {
  const data = await query(type, { ...filters, page: 1, size: 500 });
  const rows = data.list.map(r => {
    const obj = {};
    for (const c of data.columns) obj[c.key] = r[c.key] ?? '';
    return obj;
  });
  return { columns: data.columns, rows, label: data.label, labelVi: data.labelVi };
}

export default { LEDGER_DEFS, columns, query, exportRows, isValidLedgerType };
