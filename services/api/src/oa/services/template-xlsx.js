// ============================================================
// template-xlsx —— 服务端生成「带下拉选」的导入模板
// ------------------------------------------------------------
// 背景：这几份模板原来是**浏览器端**用 SheetJS 现拼的（dist 压缩产物里写死列定义），
//   SheetJS 社区版只能读不能写 dataValidation，所以以前下载到的模板一律是「纯空表」，
//   班次、频率类型、状态这些**固定取值字段**只能靠人肉打字 → 打错一个字母，导入时整行报错。
//
// 为什么搬到服务端：
//   1) 下拉选必须后处理 xlsx 的 sheet xml（见 lib/xlsx-dv.js），浏览器里做 = 把一个
//      jszip 逻辑再塞进压缩产物，改一次要反编译一次；
//   2) 取值域的真值在库里（班次定义 / 部门编码 / 岗位字典），服务端取数永远是最新的；
//   3) 解析与生成同源，模板列顺序和导入器的表头别名不会再各改各的。
//
// 兼容性铁律：
//   · 表头文字**逐字保持不变**——导入器的表头别名是精确匹配（normHeader / HEADER_ALIAS），
//     改一个字就会变成「表头认不出 → 服务端收到 {} → 每行报必填」。
//   · 列顺序不能动：DV 的 sqref 是按列算出来的，而别处（如设备台账的示例行）也按位置取值。
// ============================================================
import XLSX from 'xlsx';
import { many } from '../db/index.js';
import { injectDataValidations, listRule, wholeNumberRule } from '../lib/xlsx-dv.js';
import { REST_CODE } from './schedule-service.js';

/** 三语取值：vi / en 缺省回退中文 */
function L(lang, zh, vi, en) {
  if (lang === 'vi') return vi || zh;
  if (lang === 'en') return en || zh;
  return zh;
}

/** A 列起算的列号（0 基）→ 'C' */
function colLetter(idx) {
  return XLSX.utils.encode_col(idx);
}

/** 列定义 → 表头数组 */
function headersOf(cols, lang) {
  return cols.map(c => L(lang, c.zh, c.vi, c.en));
}

/** 列定义 → 列宽 */
function colsOf(cols) {
  return cols.map(c => ({ wch: c.wch || 14 }));
}

/** 按 key 找列字母，找不到就抛（改了列定义却忘了改 DV，必须当场炸而不是静默失效） */
function colByKey(cols, key) {
  const i = cols.findIndex(c => c.key === key);
  if (i < 0) throw new Error(`模板列定义里没有 ${key}，无法绑定下拉选`);
  return colLetter(i);
}

/** 把 [行] 拼进工作簿 */
function addSheet(wb, name, aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (widths) ws['!cols'] = widths;
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

function write(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/* ============================================================
 * 取数
 * ==========================================================*/

async function loadShifts() {
  return many(
    `SELECT code, name, name_vi, start_time, end_time, cross_day
       FROM attendance_shift_def WHERE active = TRUE
      ORDER BY sort_order NULLS LAST, code`
  );
}

async function loadDepartments() {
  return many(
    `SELECT code, name, name_vi FROM org_department
      WHERE code IS NOT NULL ORDER BY code`
  );
}

async function loadPositions() {
  return many(
    `SELECT code, name_zh, name_vi FROM sys_i18n_dict
      WHERE dict_type = 'position' AND active = TRUE
      ORDER BY sort_order, code`
  );
}

/** 频率类型：与 services/frequency-field-service.js 的 FREQ_TYPES 保持一致 */
const FREQ_TYPES = [
  { code: 'day', zh: '每日', vi: 'Hằng ngày' },
  { code: 'week', zh: '每周', vi: 'Hằng tuần' },
  { code: 'month', zh: '每月', vi: 'Hằng tháng' },
  { code: 'quarter', zh: '每季', vi: 'Hằng quý' },
  { code: 'year', zh: '每年', vi: 'Hằng năm' },
];

/* ============================================================
 * 1) 考勤排班导入模板  /api/attendance/schedule/template.xlsx
 * ==========================================================*/

const SCHEDULE_COLS = [
  { key: 'employee_no', zh: '工号', vi: 'Mã nhân viên', en: 'Employee No.', wch: 12 },
  { key: 'work_date', zh: '日期', vi: 'Ngày', en: 'Date', wch: 14 },
  { key: 'shift_code', zh: '班次编码', vi: 'Mã ca', en: 'Shift Code', wch: 14 },
  { key: 'remark', zh: '备注', vi: 'Ghi chú', en: 'Remark', wch: 24 },
];

export async function buildScheduleImportXlsx(lang = 'zh') {
  const shifts = await loadShifts();
  const codes = [...shifts.map(s => s.code), REST_CODE];

  const wb = XLSX.utils.book_new();
  addSheet(wb, '排班', [
    headersOf(SCHEDULE_COLS, lang),
    ['DT0001', '2026-01-01', shifts[0]?.code || 'day', '示例行，导入前请删除'],
  ], colsOf(SCHEDULE_COLS));

  // 班次说明：把编码与中文/越文名摆在一起，配合下拉框的输入提示
  const shiftRows = [
    ['班次编码', '名称', '名称(越)', '开始', '结束', '跨天'],
    ...shifts.map(s => [s.code, s.name || '', s.name_vi || '', s.start_time || '', s.end_time || '', s.cross_day ? '是' : '']),
    [REST_CODE, '休息', 'Nghỉ', '', '', ''],
  ];
  addSheet(wb, '班次说明', shiftRows, [{ wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 8 }]);

  const prompt = shifts.map(s => `${s.name}=${s.code}`).join(' / ') + ` / 休息=${REST_CODE}`;
  const buf = write(wb);
  return injectDataValidations(buf, {
    '排班': [
      listRule(`${colByKey(SCHEDULE_COLS, 'shift_code')}2:${colByKey(SCHEDULE_COLS, 'shift_code')}5000`, codes, {
        promptTitle: '班次编码',
        prompt: `从下拉里选。${prompt}`,
        errorTitle: '班次编码不对',
        error: `只能填编码（${codes.join(' / ')}），不要填中文名。详见「班次说明」页。`,
      }),
      hintRule(`${colByKey(SCHEDULE_COLS, 'work_date')}2:${colByKey(SCHEDULE_COLS, 'work_date')}5000`, {
        promptTitle: '日期',
        prompt: '写成 2026-11-02；也认 2026/11/2 或 20261102。',
      }),
    ],
  });
}

/* ============================================================
 * 2) 设备台账导入模板  /api/equipment/template.xlsx
 * ==========================================================*/

const EQUIPMENT_COLS = [
  { key: 'code', zh: '资产编号', vi: 'Mã tài sản', en: 'Asset No.', wch: 14 },
  { key: 'name', zh: '设备名称', vi: 'Tên thiết bị', en: 'Equipment Name', wch: 22 },
  { key: 'model', zh: '型号', vi: 'Kiểu mẫu', en: 'Model', wch: 16 },
  { key: 'spec', zh: '规格/量程', vi: 'Thông số', en: 'Spec / Range', wch: 18 },
  { key: 'manufacturer', zh: '制造商', vi: 'Nhà sản xuất', en: 'Manufacturer', wch: 18 },
  { key: 'serial_no', zh: '出厂编号', vi: 'Số sê-ri', en: 'Serial No.', wch: 16 },
  { key: 'location', zh: '安装位置', vi: 'Vị trí', en: 'Location', wch: 16 },
  { key: 'dept_code', zh: '使用部门编码', vi: 'Mã bộ phận', en: 'Department Code', wch: 16 },
  { key: 'purchase_date', zh: '购置日期', vi: 'Ngày mua', en: 'Purchase Date', wch: 14 },
  { key: 'first_external_date', zh: '首次外校日期', vi: 'Ngày hiệu chuẩn lần đầu', en: 'First External Calibration', wch: 18 },
  { key: 'maintain_cycle_days', zh: '保养周期(天)', vi: 'Chu kỳ bảo dưỡng (ngày)', en: 'Maintenance Cycle (days)', wch: 16 },
  { key: 'external_cycle_days', zh: '外校周期(天)', vi: 'Chu kỳ hiệu chuẩn (ngày)', en: 'External Calibration Cycle (days)', wch: 18 },
  { key: 'freq_type', zh: '点检频率类型', vi: 'Loại tần suất', en: 'Inspection Frequency Type', wch: 16 },
  { key: 'freq_interval', zh: '频率间隔', vi: 'Khoảng tần suất', en: 'Interval', wch: 12 },
];

export async function buildEquipmentImportXlsx(lang = 'zh') {
  const depts = await loadDepartments();
  const sheetName = L(lang, '导入模板', 'Mẫu nhập', 'Import template');

  // 示例行按 key 取值（不靠数逗号：14 列里漏一个空串，整行就会右移一列）
  const sample = {
    code: 'EQ-001',
    name: L(lang, '示例设备', 'Máy ví dụ', 'Sample equipment'),
    maintain_cycle_days: 30,
    external_cycle_days: 365,
    freq_type: 'month',
    freq_interval: 1,
  };

  const wb = XLSX.utils.book_new();
  addSheet(wb, sheetName, [
    headersOf(EQUIPMENT_COLS, lang),
    EQUIPMENT_COLS.map(c => (sample[c.key] !== undefined ? sample[c.key] : '')),
  ], colsOf(EQUIPMENT_COLS));

  // 填写说明（原来没有这一页：频率类型只有 'month' 一个示例值，用户不知道还有哪几种）
  const info = [
    ['类别', '内容', '说明'],
    ['必填', '资产编号', '唯一。已存在的编号会更新该设备，不会重复建'],
    ['选填', '使用部门编码', '从下拉里选（见本页下方清单）'],
    ['选填', '购置日期 / 首次外校日期', '写成 2026-11-02；也认 2026/11/2 或 20261102'],
    ['选填', '保养周期(天) / 外校周期(天)', '整数天数；用于自动推算下次保养 / 下次外校日期'],
    ['选填', '点检频率类型', 'day / week / month / quarter / year；留空按每日'],
    ['选填', '频率间隔', '与频率类型配合：week + 2 = 每两周；month + 1 = 每月'],
    [],
    ['—— 点检频率类型 ——', '', ''],
    ['编码', '中文', '越文'],
    ...FREQ_TYPES.map(f => [f.code, f.zh, f.vi]),
    [],
    ['—— 当前部门（可复制到「使用部门编码」列）——', '', ''],
    ['部门编码', '部门名称', '部门名称(越)'],
    ...depts.map(d => [d.code, d.name, d.name_vi || '']),
  ];
  addSheet(wb, '填写说明', info, [{ wch: 34 }, { wch: 30 }, { wch: 52 }]);

  const deptCol = colByKey(EQUIPMENT_COLS, 'dept_code');
  const freqCol = colByKey(EQUIPMENT_COLS, 'freq_type');
  const ivCol = colByKey(EQUIPMENT_COLS, 'freq_interval');

  const buf = write(wb);
  return injectDataValidations(buf, {
    [sheetName]: [
      // 部门编码：软校验（部门会新增/改名，不能因为清单过期就把人挡在门外）
      listRule(`${deptCol}2:${deptCol}2000`, depts.map(d => d.code), {
        errorStyle: 'warning',
        promptTitle: '使用部门编码',
        prompt: '建议从下拉里选；填错也不拦，导入时按编码匹配部门。',
        errorTitle: '部门编码不在清单里',
        error: depts.length ? `现有：${depts.map(d => d.code).join(' / ')}` : '当前还没有带编码的部门',
      }),
      // 频率类型：硬校验（导入逻辑只认这 5 个值）
      listRule(`${freqCol}2:${freqCol}2000`, FREQ_TYPES.map(f => f.code), {
        promptTitle: '点检频率类型',
        prompt: '每日=day / 每周=week / 每月=month / 每季=quarter / 每年=year',
        errorTitle: '频率类型不对',
        error: '只能选 day / week / month / quarter / year',
      }),
      wholeNumberRule(`${ivCol}2:${ivCol}2000`, {
        min: 1, max: 999,
        promptTitle: '频率间隔',
        prompt: '正整数。week + 2 = 每两周；month + 1 = 每月',
        errorTitle: '间隔应为正整数',
        error: '请填 1~999 的整数',
      }),
    ],
  });
}

/* ============================================================
 * 3) 人员信息导入模板  /api/org/import/template.xlsx
 * ==========================================================*/

const ORG_COLS = [
  { key: 'employee_no', zh: '工号', vi: 'Mã nhân viên', en: 'Employee No.', wch: 12 },
  { key: 'real_name', zh: '姓名', vi: 'Họ tên', en: 'Full Name', wch: 20 },
  { key: 'dept_code', zh: '部门编码', vi: 'Mã bộ phận', en: 'Department Code', wch: 14 },
  { key: 'dept_name', zh: '部门名称', vi: 'Tên bộ phận', en: 'Department', wch: 22 },
  { key: 'dept_name_vi', zh: '部门名称(越)', vi: 'Tên bộ phận (Việt)', en: 'Department (VI)', wch: 24 },
  { key: 'parent_code', zh: '上级部门编码', vi: 'Mã bộ phận cấp trên', en: 'Parent Dept Code', wch: 16 },
  { key: 'position_code', zh: '岗位编码', vi: 'Mã vị trí', en: 'Position Code', wch: 14 },
  { key: 'email', zh: '邮箱', vi: 'Email', en: 'Email', wch: 24 },
  { key: 'phone', zh: '手机', vi: 'Điện thoại', en: 'Phone', wch: 16 },
  { key: 'status', zh: '状态', vi: 'Trạng thái', en: 'Status', wch: 10 },
];

export async function buildOrgImportXlsx(lang = 'zh') {
  const [depts, positions] = await Promise.all([loadDepartments(), loadPositions()]);
  const wb = XLSX.utils.book_new();

  // 与改造前一致：只有表头，不给示例行（人员数据一旦被当示例导进去就是脏数据）
  addSheet(wb, L(lang, '人员', 'Nhân sự', 'Staff'), [headersOf(ORG_COLS, lang)], colsOf(ORG_COLS));

  const info = [
    ['类别', '内容', '说明'],
    ['必填', '姓名', '必填。同部门+同姓名+同岗位视为同一人，会更新而不是重复建人'],
    ['选填', '工号', '留空则自动生成（DT+序号）；同时也作为登录用户名'],
    ['选填', '部门名称', '推荐直接抄下面的部门名称；有编码时会优先按编码匹配'],
    ['选填', '部门编码', '可留空。留空即按「部门名称」匹配或新建'],
    ['选填', '岗位名称/编码', '填中文岗位名称即可（见下方清单），系统自动转成编码'],
    ['选填', '邮箱', '需为合法邮箱格式，否则整行报错跳过'],
    ['选填', '状态', '在职 / 离职；留空视为在职'],
    ['提示', '初始密码', '统一为系统初始密码，首次登录强制修改'],
    [],
    ['—— 当前部门（可复制到「部门名称」列）——', '', ''],
    ['部门名称', '部门编码', '上级部门'],
    ...depts.map(d => [d.name, d.code || '', '']),
    [],
    ['—— 当前岗位（可复制到「岗位名称」列）——', '', ''],
    ['岗位名称(中)', '岗位名称(越)', '岗位编码'],
    ...positions.map(p => [p.name_zh, p.name_vi || '', p.code]),
  ];
  addSheet(wb, '填写说明', info, [{ wch: 34 }, { wch: 34 }, { wch: 16 }]);

  const deptCol = colByKey(ORG_COLS, 'dept_code');
  const statusCol = colByKey(ORG_COLS, 'status');

  const buf = write(wb);
  return injectDataValidations(buf, {
    [L(lang, '人员', 'Nhân sự', 'Staff')]: [
      listRule(`${deptCol}2:${deptCol}2000`, depts.map(d => d.code), {
        errorStyle: 'warning',
        promptTitle: '部门编码',
        prompt: '可留空（按部门名称匹配）；要填就填编码，见「填写说明」页。',
        errorTitle: '部门编码不在清单里',
        error: depts.length ? `现有：${depts.map(d => d.code).join(' / ')}` : '当前还没有带编码的部门',
      }),
      // 状态：导入器还认 active/inactive/离职 等一串同义词，所以只做提醒，不硬拦
      listRule(`${statusCol}2:${statusCol}2000`, ['在职', '离职'], {
        errorStyle: 'warning',
        promptTitle: '状态',
        prompt: '在职 / 离职；留空视为在职。',
        errorTitle: '状态不是常用写法',
        error: '建议填「在职」或「离职」（也认 active / inactive）',
      }),
    ],
  });
}

/* ============================================================
 * 4) 入职登记导入模板  /api/onboardings/template.xlsx
 * ==========================================================*/

const ONBOARDING_COLS = [
  { key: 'realName', zh: '姓名', vi: 'Họ tên', en: 'Full Name', wch: 18 },
  { key: 'gender', zh: '性别', vi: 'Giới tính', en: 'Gender', wch: 10 },
  { key: 'birthDate', zh: '出生日期', vi: 'Ngày sinh', en: 'Date of Birth', wch: 14 },
  { key: 'idCardNo', zh: '身份证号', vi: 'Số CMND/CCCD', en: 'ID Card No.', wch: 20 },
  { key: 'phone', zh: '手机', vi: 'Điện thoại', en: 'Phone', wch: 16 },
  { key: 'email', zh: '邮箱', vi: 'Email', en: 'Email', wch: 24 },
  { key: 'education', zh: '学历', vi: 'Học vấn', en: 'Education', wch: 12 },
  { key: 'deptName', zh: '部门', vi: 'Bộ phận', en: 'Department', wch: 20 },
  { key: 'positionName', zh: '岗位', vi: 'Vị trí', en: 'Position', wch: 18 },
  { key: 'hireDate', zh: '入职日期', vi: 'Ngày vào làm', en: 'Hire Date', wch: 14 },
  { key: 'probationDays', zh: '试用期(天)', vi: 'Thử việc (ngày)', en: 'Probation (days)', wch: 13 },
  { key: 'emergencyContact', zh: '紧急联系人', vi: 'Người liên hệ khẩn cấp', en: 'Emergency Contact', wch: 16 },
  { key: 'emergencyPhone', zh: '紧急联系电话', vi: 'SĐT khẩn cấp', en: 'Emergency Phone', wch: 18 },
  { key: 'employeeNo', zh: '工号', vi: 'Mã nhân viên', en: 'Employee No.', wch: 12 },
];

export async function buildOnboardingImportXlsx(lang = 'zh') {
  const [depts, positions] = await Promise.all([loadDepartments(), loadPositions()]);
  const wb = XLSX.utils.book_new();
  addSheet(wb, L(lang, '入职登记', 'Đăng ký vào làm', 'Onboarding'),
    [headersOf(ONBOARDING_COLS, lang)], colsOf(ONBOARDING_COLS));

  const info = [
    ['类别', '内容', '说明'],
    ['必填', '姓名', '必填'],
    ['选填', '性别', '男 / 女 / 其他'],
    ['选填', '出生日期', '如 1995-08-12（也可用 / 或 . 分隔）'],
    ['选填', '身份证号', '填了会做查重；导入后默认只显示掩码，查看需授权'],
    ['选填', '入职日期', '如 2026-03-01；不填则确认入职时按当天'],
    ['选填', '试用期(天)', '按天填；留空默认 6 天，0 表示无试用期。越南劳动法第 25 条：普通员工 6 天 / 技术类 30 天 / 大专及以上 60 天 / 管理岗 180 天'],
    ['选填', '部门', '抄下面的部门名称（有编码也可填编码）'],
    ['选填', '岗位', '抄下面的岗位名称'],
    ['选填', '工号', '留空则确认入职时自动分配 DT 号'],
    ['提示', '导入后状态', '一律为「待入职」；核对后勾选行点「批量确认入职」才建账号'],
    [],
    ['—— 当前部门 ——', '', ''],
    ['部门名称', '部门编码', ''],
    ...depts.map(d => [d.name, d.code || '', '']),
    [],
    ['—— 当前岗位 ——', '', ''],
    ['岗位名称', '岗位编码', ''],
    ...positions.map(p => [p.name_zh, p.code, '']),
  ];
  addSheet(wb, '填写说明', info, [{ wch: 30 }, { wch: 40 }, { wch: 14 }]);

  const genderCol = colByKey(ONBOARDING_COLS, 'gender');
  const deptCol = colByKey(ONBOARDING_COLS, 'deptName');
  const posCol = colByKey(ONBOARDING_COLS, 'positionName');

  const sheetName = L(lang, '入职登记', 'Đăng ký vào làm', 'Onboarding');
  const buf = write(wb);
  return injectDataValidations(buf, {
    [sheetName]: [
      listRule(`${genderCol}2:${genderCol}2000`, ['男', '女', '其他'], {
        errorStyle: 'warning',
        promptTitle: '性别',
        prompt: '男 / 女 / 其他',
        errorTitle: '性别不在常用清单里',
        error: '建议填「男」「女」或「其他」',
      }),
      listRule(`${deptCol}2:${deptCol}2000`, depts.map(d => d.name), {
        errorStyle: 'warning',
        promptTitle: '部门',
        prompt: '从下拉里选部门名称（也可填部门编码）',
        errorTitle: '部门不在清单里',
        error: '导入时会按名称或编码匹配，找不到会新建部门，请确认无误',
      }),
      listRule(`${posCol}2:${posCol}2000`, positions.map(p => p.name_zh), {
        errorStyle: 'warning',
        promptTitle: '岗位',
        prompt: '从下拉里选岗位名称（也可填岗位编码）',
        errorTitle: '岗位不在清单里',
        error: '建议从下拉里选；填错会按「未知岗位」处理',
      }),
    ],
  });
}

/**
 * 只出输入提示、不做校验的规则（日期这类字段：给格式提示，但不拦人）。
 * 用 textLength >= 0 做「永远成立」的壳子 —— OOXML 没有 type="none"。
 */
function hintRule(ref, { promptTitle, prompt } = {}) {
  return {
    ref, type: 'textLength', operator: 'greaterThanOrEqual', formula1: '0',
    promptTitle, prompt, error: '',
  };
}
