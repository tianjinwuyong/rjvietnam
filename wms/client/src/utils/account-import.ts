// xlsx 只在「下载模板 / 解析导入文件」时才用得到，没必要进首屏包。
// 改为按需动态加载（首次点击时才下载 chunk），可把约 800KB 移出首屏。
let xlsxModule: Promise<typeof import('xlsx')> | null = null;
const loadXLSX = () => (xlsxModule ??= import('xlsx'));

/**
 * 账号批量导入的模版生成。
 *
 * 生成两份工作表（**数据表必须排在第一位**，服务端只读第一个 sheet）：
 *  1. `账号导入`：表头 + 一行示例，用户在此填写；
 *  2. `填写说明`：规则说明 + 从系统实时取到的角色清单。
 *
 * 两个刻意的设计：
 *  - **示例行的账号故意写成中文**（`示例_请先删除本行`）。若用户忘记删除，
 *    服务端会因账号字符合法性校验失败而**整体拒绝**这份文件，一个账号都不会建；
 *    反之若给一个看起来合法的示例账号（如 zhangsan），用户忘删就会静默多建一个假账号。
 *  - 表头与说明按语言切换，但服务端解析同时认中/英/越三种表头，列顺序也可任意调整。
 */

export type AccountTemplateLang = 'zh' | 'en' | 'vi';

export interface AccountRoleOption {
  roleCode: string;
  roleName: string;
}

interface TemplateTexts {
  sheetName: string;
  noteSheetName: string;
  fileName: string;
  headers: string[];
  sampleRow: string[];
  notes: string[];
  roleCodeLabel: string;
  roleNameLabel: string;
  roleListHeading: string;
}

const TEMPLATE: Record<AccountTemplateLang, TemplateTexts> = {
  zh: {
    sheetName: '账号导入',
    noteSheetName: '填写说明',
    fileName: '账号导入模版',
    headers: ['账号', '姓名', '角色编码', '所属工段', '初始密码'],
    sampleRow: ['示例_请先删除本行', '示例姓名', 'wh_keeper', 'smt', ''],
    notes: [
      '【填写说明】',
      '1. 第 2 行是格式示例，导入前请删除或替换；忘记删除会导致整份文件被拒绝，不会建出任何账号。',
      '2. 必填列：账号、姓名、角色编码。所属工段、初始密码可以留空。',
      '3. 列顺序可以调整，表头换成英文或越南文也能识别。',
      '4. 初始密码留空则默认为 123；请在员工首次登录后提醒其尽快修改。',
      '5. 账号只能包含字母、数字、下划线、点、连字符；不能使用 admin（内置管理员账号）。',
      '6. 所属工段可填：smt、dip、assembly、packing；留空表示不限。',
      '7. 角色编码必须来自下面的角色清单，也可以直接填写角色名称。',
      '8. 账号在文件中重复、或与系统已有账号重复，都会被拒绝。',
      '9. 只要有一行不合法，整份文件都不导入；请按提示修正后重新上传。',
    ],
    roleCodeLabel: '角色编码',
    roleNameLabel: '角色名称',
    roleListHeading: '【可选角色清单】',
  },
  en: {
    sheetName: 'Accounts',
    noteSheetName: 'Instructions',
    fileName: 'account-import-template',
    headers: ['Account', 'Name', 'Role Code', 'Work Section', 'Initial Password'],
    // 故意含空格 → 不是合法账号，用户忘删时整份文件会被拒绝而不是静默建号
    sampleRow: ['example delete this row', 'Example Name', 'wh_keeper', 'smt', ''],
    notes: [
      '[Instructions]',
      '1. Row 2 is a format example — delete or replace it before importing. If you forget, the whole file will be rejected and no account will be created.',
      '2. Required columns: Account, Name, Role Code. Work Section and Initial Password may be left blank.',
      '3. Column order is flexible; Chinese and Vietnamese headers are also recognised.',
      '4. A blank Initial Password defaults to 123 — please remind staff to change it after first login.',
      '5. Account may contain letters, digits, underscore, dot and hyphen only; "admin" is reserved.',
      '6. Work Section accepts: smt, dip, assembly, packing; leave blank for unrestricted.',
      '7. Role Code must come from the list below; the role name in Chinese is also accepted.',
      '8. Duplicated accounts inside the file, or already existing in the system, will be rejected.',
      '9. If any row is invalid the file is rejected as a whole — fix the listed errors and upload again.',
    ],
    roleCodeLabel: 'Role Code',
    roleNameLabel: 'Role Name',
    roleListHeading: '[Available roles]',
  },
  vi: {
    sheetName: 'Tài khoản',
    noteSheetName: 'Hướng dẫn',
    fileName: 'mau-nhap-tai-khoan',
    headers: ['Tài khoản', 'Họ tên', 'Mã vai trò', 'Bộ phận', 'Mật khẩu ban đầu'],
    sampleRow: ['example_delete_this_row', 'Tên ví dụ', 'wh_keeper', 'smt', ''],
    notes: [
      '[Hướng dẫn điền]',
      '1. Dòng 2 là ví dụ định dạng — hãy xoá hoặc thay thế trước khi nhập. Nếu quên xoá, toàn bộ tệp sẽ bị từ chối và không tài khoản nào được tạo.',
      '2. Cột bắt buộc: Tài khoản, Họ tên, Mã vai trò. Bộ phận và Mật khẩu ban đầu có thể để trống.',
      '3. Thứ tự cột có thể thay đổi; tiêu đề tiếng Trung và tiếng Anh cũng được nhận diện.',
      '4. Mật khẩu ban đầu để trống sẽ mặc định là 123 — hãy nhắc nhân viên đổi sau lần đăng nhập đầu tiên.',
      '5. Tài khoản chỉ được chứa chữ cái, chữ số, dấu gạch dưới, dấu chấm và dấu gạch ngang; không dùng "admin".',
      '6. Bộ phận nhận các giá trị: smt, dip, assembly, packing; để trống nghĩa là không giới hạn.',
      '7. Mã vai trò phải nằm trong danh sách bên dưới; cũng có thể điền tên vai trò bằng tiếng Trung.',
      '8. Tài khoản trùng trong tệp hoặc đã tồn tại trong hệ thống đều bị từ chối.',
      '9. Chỉ cần một dòng không hợp lệ thì cả tệp không được nhập — hãy sửa theo thông báo rồi tải lên lại.',
    ],
    roleCodeLabel: 'Mã vai trò',
    roleNameLabel: 'Tên vai trò',
    roleListHeading: '[Danh sách vai trò khả dụng]',
  },
};

/** 生成并下载账号导入模版 */
export async function downloadAccountTemplate(
  lang: AccountTemplateLang = 'zh',
  roles: AccountRoleOption[] = [],
): Promise<void> {
  const XLSX = await loadXLSX();
  const t = TEMPLATE[lang] || TEMPLATE.zh;

  // 数据表：表头 + 示例行
  const dataSheet = XLSX.utils.aoa_to_sheet([t.headers, t.sampleRow]);
  dataSheet['!cols'] = [
    { wch: 26 },
    { wch: 16 },
    { wch: 24 },
    { wch: 16 },
    { wch: 18 },
  ];

  // 说明表：规则 + 角色清单
  const noteRows: string[][] = t.notes.map((line) => [line]);
  noteRows.push([]);
  noteRows.push([t.roleListHeading]);
  noteRows.push([t.roleCodeLabel, t.roleNameLabel]);
  for (const role of roles) {
    noteRows.push([role.roleCode, role.roleName]);
  }
  const noteSheet = XLSX.utils.aoa_to_sheet(noteRows);
  noteSheet['!cols'] = [{ wch: 96 }, { wch: 26 }];

  const workbook = XLSX.utils.book_new();
  // 顺序不能变：服务端只解析第一个工作表
  XLSX.utils.book_append_sheet(workbook, dataSheet, t.sheetName);
  XLSX.utils.book_append_sheet(workbook, noteSheet, t.noteSheetName);

  XLSX.writeFile(workbook, `${t.fileName}.xlsx`);
}
