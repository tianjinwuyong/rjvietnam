// ============================================================
// 排班计划 Excel 读写（服务端生成 / 解析 xlsx）
// ------------------------------------------------------------
// 为什么放服务端：
//   · 新页面是独立 HTML，dist 里没有可复用的 SheetJS 全局；
//   · 服务端解析可以做与 API 完全一致的校验（工号是否在本部门、日期是否在当月），
//     用户在 Excel 里写错时能拿到「第几行错在哪」，而不是整个导入失败。
//
// 表头同时接受中文 / 越南语 / 英文，方便 HR 与越南籍主管共用一份模板。
// 日期列兼容三种写法：真日期单元格、'2026-11-02' 字符串、20261102 数字。
// ============================================================
import XLSX from 'xlsx';
import { injectDataValidations, listRule } from '../lib/xlsx-dv.js';

/** 表头别名 → 内部字段 */
const HEADER_ALIAS = {
  employee_no: ['工号', '員工編號', 'mã nhân viên', 'ma nhan vien', 'employee no', 'employee_no', '工号/编号'],
  real_name: ['姓名', 'họ tên', 'ho ten', 'name', 'real_name'],
  work_date: ['日期', 'ngày', 'ngay', 'date', 'work_date'],
  shift_code: ['班次', 'ca', 'shift', 'shift_code', '班次编码'],
  remark: ['备注', 'ghi chú', 'ghi chu', 'remark', 'note'],
};

function normHeader(h) {
  const s = String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [field, list] of Object.entries(HEADER_ALIAS)) {
    if (list.some(a => a.toLowerCase() === s)) return field;
  }
  return null;
}

/** Date | 'YYYY-MM-DD' | 20261102 | Excel 序列号 → 'YYYY-MM-DD' | null */
export function toDateStr(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);   // 20261102
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 90000) {
    // Excel 日期序列号（1900 基准，含闰年 bug 偏移）
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * 解析上传的 xlsx：返回 { rows, errors }
 * rows 结构 = { employee_no, work_date, shift_code, remark }
 */
export function parseImportBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: [{ row: 0, msg: '文件里没有工作表' }] };
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  if (!raw.length) return { rows: [], errors: [{ row: 0, msg: '内容为空（表头之外没有数据行）' }] };

  const rows = [];
  const errors = [];
  raw.forEach((r, idx) => {
    const rowNo = idx + 2;
    const mapped = {};
    for (const [k, v] of Object.entries(r)) {
      const f = normHeader(k);
      if (f) mapped[f] = v;
    }
    if (!mapped.employee_no && !mapped.work_date && !mapped.shift_code) return; // 空行跳过
    const date = toDateStr(mapped.work_date);
    rows.push({
      employee_no: mapped.employee_no != null ? String(mapped.employee_no).trim() : '',
      work_date: date || (mapped.work_date != null ? String(mapped.work_date).trim() : ''),
      shift_code: mapped.shift_code != null ? String(mapped.shift_code).trim() : '',
      remark: mapped.remark != null ? String(mapped.remark) : '',
      _row: rowNo,
    });
    if (!date && mapped.work_date !== '') {
      errors.push({ row: rowNo, field: 'work_date', msg: `日期无法识别：${mapped.work_date}` });
    }
  });
  return { rows, errors };
}

function autoWidth(rows) {
  const widths = [];
  rows.forEach(row => row.forEach((c, i) => {
    const len = String(c == null ? '' : c).replace(/[^\x00-\xff]/g, '00').length;
    widths[i] = Math.max(widths[i] || 8, Math.min(len + 2, 40));
  }));
  return widths.map(w => ({ wch: w }));
}

/** 生成导入模板：数据表 + 班次说明表（班次列带下拉选） */
export async function buildTemplate(shifts = [], sample = {}) {
  const headers = ['工号', '姓名', '日期', '班次', '备注'];
  const example = [
    sample.employee_no || 'RJ001',
    sample.real_name || 'NGUYEN VAN A',
    sample.work_date || '2026-11-02',
    sample.shift_code || (shifts[0]?.code || 'day'),
    '示例行，导入前请删除',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = autoWidth([headers, example]);
  // 日期列设为文本，避免 Excel 自动格式化成序列号导致回读歧义
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 1; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 2 });
    if (ws[addr]) ws[addr].z = '@';
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '排班');

  if (shifts.length) {
    const sRows = [['班次编码', '名称', '名称(越)', '开始', '结束', '跨天'],
      ...shifts.map(s => [s.code, s.name || '', s.name_vi || '', s.start_time || '', s.end_time || '', s.cross_day ? '是' : '']),
      [REST_CODE, '休息', 'Nghỉ', '', '', '']];
    const ws2 = XLSX.utils.aoa_to_sheet(sRows);
    ws2['!cols'] = autoWidth(sRows);
    XLSX.utils.book_append_sheet(wb, ws2, '班次说明');
  }

  // 班次列（D）给下拉选：导入只认**编码**（importRows 里是 Set 精确匹配），
  // 靠人肉打字等于把「打错一个字母 → 整行报错」的概率留在现场。
  const codes = [...shifts.map(s => s.code), REST_CODE];
  const validations = shifts.length
    ? {
      排班: [
        listRule('D2:D5000', codes, {
          promptTitle: '班次',
          prompt: `从下拉里选。${shifts.map(s => `${s.name}=${s.code}`).join(' / ')} / 休息=${REST_CODE}`,
          errorTitle: '班次编码不对',
          error: `只能填编码（${codes.join(' / ')}），不要填中文名。详见「班次说明」页。`,
        }),
      ],
    }
    : {};

  return injectDataValidations(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), validations);
}

/**
 * 「休息」占位码。与 schedule-service 的 REST_CODE 同值 ——
 * 这里单独定义是为了让本文件不 import schedule-service（那个模块体量大，且会牵出 db 依赖）。
 */
const REST_CODE = 'rest';

/**
 * 生成计划导出文件：宽表（每行一个人，列为 1..31 号），便于主管在 Excel 里直观核对。
 * 同时保留一个明细表（工号/日期/班次），可直接改完再导入。
 */
export function buildExport({ plan, users, dates, items, shifts }) {
  const byKey = new Map();
  items.forEach(i => byKey.set(`${i.user_id}|${i.work_date}`, i.shift_code));

  const wb = XLSX.utils.book_new();

  // 明细表（可直接作为导入源）
  const detailHead = ['工号', '姓名', '日期', '班次', '备注'];
  const detailRows = [];
  users.forEach(u => {
    dates.forEach(d => {
      const code = byKey.get(`${u.id}|${d}`);
      if (code) detailRows.push([u.employee_no || '', u.real_name || '', d, code, '']);
    });
  });
  const wsDetail = XLSX.utils.aoa_to_sheet([detailHead, ...detailRows]);
  wsDetail['!cols'] = autoWidth([detailHead, ...detailRows.slice(0, 50)]);
  XLSX.utils.book_append_sheet(wb, wsDetail, '明细');

  // 宽表（人 × 日）
  const head = ['工号', '姓名', '部门', ...dates.map(d => Number(d.slice(8, 10)))];
  const wide = [head];
  users.forEach(u => {
    wide.push([
      u.employee_no || '', u.real_name || '', u.department_name || '',
      ...dates.map(d => byKey.get(`${u.id}|${d}`) || ''),
    ]);
  });
  const wsWide = XLSX.utils.aoa_to_sheet(wide);
  wsWide['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 14 }, ...dates.map(() => ({ wch: 7 }))];
  wsWide['!freeze'] = { xSplit: 3, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsWide, '月历');

  // 说明
  const info = [
    ['计划编号', plan.plan_no],
    ['月份', plan.year_month],
    ['部门', plan.department_name || ''],
    ['状态', plan.status],
    ['人数', users.length],
    ['格数', items.length],
    ['导出时间', new Date().toISOString().slice(0, 19).replace('T', ' ')],
    [],
    ['可用班次', shifts.map(s => s.code).join(' / ')],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(info);
  wsInfo['!cols'] = [{ wch: 12 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, '说明');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
