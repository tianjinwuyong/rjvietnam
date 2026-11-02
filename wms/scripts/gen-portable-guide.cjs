/**
 * 生成《WMS 免安装版 本地服务器部署操作指导书》中越双语 Word 文档
 * 与标准部署版的差异：本版内置依赖与构建产物，用引导式启动器
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak, Footer, Header, PageNumber, TableOfContents, LevelFormat,
  convertMillimetersToTwip,
} = require('docx');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'WMS免安装版部署操作指导书_中越双语.docx';

const C = {
  brand: '1F4E79', brandLight: 'DEEAF6', accent: 'C55A11',
  warnBg: 'FFF2CC', okBg: 'E2EFDA', errBg: 'FCE4E4',
  gray: '595959', codeBg: 'F2F2F2', vi: '7F6000', tableHead: '1F4E79',
  green: '538135',
};
const FONT = 'Microsoft YaHei';
const FONT_CODE = 'Consolas';

const t = (text, opt = {}) => new TextRun({
  text, font: opt.font || FONT, size: opt.size || 21,
  bold: !!opt.bold, italics: !!opt.italics,
  color: opt.color || '000000', break: opt.break,
});

function biPair(zhText, viText, opt = {}) {
  const out = [new Paragraph({
    spacing: { before: opt.beforeZh ?? 60, after: 20, line: 300 },
    children: opt.zhRuns || [t(zhText, { size: opt.size })],
  })];
  if (viText) out.push(new Paragraph({
    spacing: { before: 0, after: opt.afterVi ?? 120, line: 300 },
    indent: { left: convertMillimetersToTwip(2) },
    children: [
      t('VI  ', { color: C.vi, bold: true, size: (opt.size || 21) - 2 }),
      t(viText, { italics: true, size: opt.size, color: '333333' }),
    ],
  }));
  return out;
}

function biHeading(level, zhText, viText, opt = {}) {
  const sizes = { 1: 32, 2: 26, 3: 23, 4: 21 };
  const colorOf = { 1: C.brand, 2: C.brand, 3: C.accent, 4: '333333' };
  const lvl = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 }[level];
  const out = [new Paragraph({
    heading: lvl,
    spacing: { before: opt.before ?? (level === 1 ? 320 : 220), after: viText ? 30 : 120 },
    pageBreakBefore: !!opt.pageBreak,
    border: level === 1 ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.brand, space: 4 } } : undefined,
    children: [t(zhText, { bold: true, size: sizes[level], color: colorOf[level] })],
  })];
  if (viText) out.push(new Paragraph({
    spacing: { before: 0, after: 140 },
    children: [t(viText, { bold: level <= 2, size: sizes[level] - 5, color: C.gray })],
  }));
  return out;
}

function bullet(zhText, viText, opt = {}) {
  const out = [new Paragraph({
    numbering: { reference: 'wms-bullet', level: opt.level || 0 },
    spacing: { before: 40, after: viText ? 0 : 80, line: 290 },
    children: opt.zhRuns || [t(zhText, { size: opt.size })],
  })];
  if (viText) out.push(new Paragraph({
    numbering: { reference: 'wms-bullet', level: opt.level || 0 },
    spacing: { before: 0, after: 80, line: 290 },
    children: [t(viText, { italics: true, size: (opt.size || 21) - 2, color: '555555' })],
  }));
  return out;
}

function step(zhText, viText, opt = {}) {
  const out = [new Paragraph({
    numbering: { reference: 'wms-step', level: 0 },
    spacing: { before: 60, after: viText ? 0 : 100, line: 300 },
    children: opt.zhRuns || [t(zhText, { size: opt.size })],
  })];
  if (viText) out.push(new Paragraph({
    numbering: { reference: 'wms-step', level: 0 },
    spacing: { before: 0, after: 100, line: 300 },
    children: [t(viText, { italics: true, size: (opt.size || 21) - 2, color: '555555' })],
  }));
  return out;
}

function codeBlock(lines, opt = {}) {
  const arr = Array.isArray(lines) ? lines : String(lines).split('\n');
  return arr.map((ln, i) => new Paragraph({
    spacing: { before: i === 0 ? 80 : 0, after: i === arr.length - 1 ? 140 : 0, line: 260 },
    shading: { type: ShadingType.CLEAR, fill: opt.fill || C.codeBg },
    indent: { left: convertMillimetersToTwip(3), right: convertMillimetersToTwip(1) },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: opt.bar || C.brand, space: 6 } },
    children: [t(ln || ' ', { font: FONT_CODE, size: 18, color: opt.color || '1A1A1A' })],
  }));
}

function callout(kind, zhText, viText) {
  const map = {
    info: { bg: C.brandLight, bar: C.brand, icon: '提示 / Ghi chú' },
    warn: { bg: C.warnBg, bar: 'BF8F00', icon: '注意 / Cảnh báo' },
    ok: { bg: C.okBg, bar: C.green, icon: '正确 / Đúng' },
    err: { bg: C.errBg, bar: 'C00000', icon: '错误 / Sai' },
  }[kind];
  const out = [new Paragraph({
    spacing: { before: 100, after: 0, line: 290 },
    shading: { type: ShadingType.CLEAR, fill: map.bg },
    indent: { left: convertMillimetersToTwip(2) },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: map.bar, space: 6 } },
    children: [t(map.icon + '：', { bold: true, size: 20, color: map.bar }), t(zhText, { size: 20 })],
  })];
  if (viText) out.push(new Paragraph({
    spacing: { before: 0, after: 100, line: 290 },
    shading: { type: ShadingType.CLEAR, fill: map.bg },
    indent: { left: convertMillimetersToTwip(2) },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: map.bar, space: 6 } },
    children: [t(viText, { italics: true, size: 18, color: '404040' })],
  }));
  return out;
}

function biTable(headers, rows, opt = {}) {
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  };
  const mkCell = (content, isHead, widthPct) => {
    const paras = [];
    if (typeof content === 'string') {
      paras.push(new Paragraph({ spacing: { before: 30, after: 30, line: 270 }, children: [t(content, { size: 19, bold: isHead, color: isHead ? 'FFFFFF' : '000000' })] }));
    } else {
      const zh = content.zh ?? '', vi = content.vi ?? '';
      paras.push(new Paragraph({
        spacing: { before: 30, after: vi ? 0 : 30, line: 270 },
        children: content.zhRuns || [t(zh, { size: 19, bold: isHead || content.bold, color: isHead ? 'FFFFFF' : '000000', font: content.mono ? FONT_CODE : undefined })],
      }));
      if (vi) paras.push(new Paragraph({
        spacing: { before: 0, after: 30, line: 260 },
        children: [t(vi, { italics: true, size: 17, color: isHead ? 'E8F0F8' : '555555' })],
      }));
    }
    return new TableCell({
      borders: cellBorders,
      shading: isHead ? { type: ShadingType.CLEAR, fill: C.tableHead } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
      children: paras,
    });
  };
  const headRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => mkCell({ zh: h.zh, vi: h.vi }, true, opt.widths ? opt.widths[i] : undefined)) });
  const bodyRows = rows.map((r) => new TableRow({ children: r.map((c, ci) => mkCell(c, false, opt.widths ? opt.widths[ci] : undefined)) }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headRow, ...bodyRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
    },
  });
}

const spacer = (h = 100) => new Paragraph({ spacing: { before: 0, after: h }, children: [t('')] });

// ============================================================
const body = [];

// ---------- 封面 ----------
body.push(
  spacer(1300),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 100 }, children: [t('WMS 仓库管理系统', { bold: true, size: 52, color: C.brand })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 380 }, children: [t('HỆ THỐNG QUẢN LÝ KHO WMS', { bold: true, size: 26, color: C.gray })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 }, children: [t('绿色免安装版', { bold: true, size: 40, color: C.green })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 100 }, children: [t('本地服务器部署操作指导书', { bold: true, size: 32, color: '000000' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 620 }, children: [t('BẢN CÀI ĐẶT XANH · HƯỚNG DẪN TRIỂN KHAI TRÊN MÁY CHỦ NỘI BỘ', { bold: true, size: 20, color: C.accent })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 70 }, children: [t('内置全部依赖与构建产物 · 无需联网 · 双击即启动', { size: 20, color: C.gray })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 70 }, children: [t('Đã tích hợp toàn bộ phụ thuộc và sản phẩm build · Không cần mạng · Nháy đúp là chạy', { italics: true, size: 17, color: C.gray })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 0 }, children: [t('文档版本 V1.0   ·   ' + new Date().toISOString().slice(0, 10), { size: 18, color: C.gray })] }),
  new Paragraph({ pageBreakBefore: true, children: [t('')] }),
);

// ---------- 目录 ----------
body.push(...biHeading(1, '目录', 'Mục lục'));
body.push(new TableOfContents('WMS-TOC', { hyperlink: true, headingStyleRange: '1-3' }));
body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 1 章  认识免安装版', 'Chương 1  Giới thiệu bản cài đặt xanh'));

body.push(...biPair(
  '本指导书专门针对「绿色免安装版」。与源码部署版最大的区别是：本版已经把全部程序依赖和构建产物打包在内，拷到目标服务器后无需联网安装依赖、无需编译，配置好数据库即可直接启动。',
  'Tài liệu này dành riêng cho "bản cài đặt xanh". Khác biệt lớn nhất so với bản triển khai từ mã nguồn: bản này đã đóng gói sẵn toàn bộ phụ thuộc và sản phẩm build, sau khi sao chép sang máy chủ đích không cần mạng để cài phụ thuộc, không cần biên dịch, chỉ cần cấu hình cơ sở dữ liệu là chạy được ngay.'
));

body.push(...biHeading(2, '1.1  两个版本对比', '1.1  So sánh hai phiên bản'));

body.push(biTable(
  [
    { zh: '对比项', vi: 'Hạng mục so sánh' },
    { zh: '免安装版（本指导书）', vi: 'Bản cài đặt xanh (tài liệu này)' },
    { zh: '源码部署版', vi: 'Bản triển khai từ mã nguồn' },
  ],
  [
    [{ zh: '程序依赖', vi: 'Phụ thuộc chương trình' }, { zh: '已内置（node_modules 约 520 MB）', vi: 'Đã tích hợp sẵn (node_modules ~520 MB)', }, { zh: '无，需联网 npm install', vi: 'Không có, cần mạng để npm install' }],
    [{ zh: '构建产物', vi: 'Sản phẩm build' }, { zh: '已构建（dist 目录）', vi: 'Đã build (thư mục dist)' }, { zh: '无，需 npm run build', vi: 'Không có, cần npm run build' }],
    [{ zh: '首次启动耗时', vi: 'Thời gian khởi động lần đầu' }, { zh: '约 10 秒', vi: 'Khoảng 10 giây' }, { zh: '5–15 分钟', vi: '5–15 phút' }],
    [{ zh: '是否需要联网', vi: 'Có cần mạng không' }, { zh: '不需要', vi: 'Không cần' }, { zh: '需要', vi: 'Cần' }],
    [{ zh: '包体积', vi: 'Dung lượng gói' }, { zh: '约 550 MB', vi: 'Khoảng 550 MB' }, { zh: '约 9 MB', vi: 'Khoảng 9 MB' }],
    [{ zh: '适用场景', vi: 'Tình huống áp dụng' }, { zh: '内网隔离、网络差、快速交付', vi: 'Mạng nội bộ cô lập, mạng kém, bàn giao nhanh' }, { zh: '正式部署、需要干净环境', vi: 'Triển khai chính thức, cần môi trường sạch' }],
  ],
  { widths: [18, 41, 41] }
));

body.push(...biHeading(2, '1.2  启动器能帮你做什么', '1.2  Bộ khởi động giúp bạn những gì'));

body.push(...biPair(
  '本版提供专用启动器「启动.bat」。双击后它会自动完成六个步骤，你只需在第二步配合填写数据库信息：',
  'Bản này cung cấp bộ khởi động riêng "启动.bat". Sau khi nháy đúp, nó tự động hoàn thành sáu bước, bạn chỉ cần phối hợp điền thông tin cơ sở dữ liệu ở bước thứ hai:'
));

body.push(biTable(
  [
    { zh: '步骤', vi: 'Bước' },
    { zh: '启动器动作', vi: 'Hành động của bộ khởi động' },
    { zh: '需要你操作吗', vi: 'Bạn có cần thao tác không' },
  ],
  [
    [{ zh: '[1/6]', vi: '[1/6]' }, { zh: '校验 Node.js 版本（必须 22 或更高）', vi: 'Kiểm tra phiên bản Node.js (phải từ 22 trở lên)' }, { zh: '不需要', vi: 'Không' }],
    [{ zh: '[2/6]', vi: '[2/6]' }, { zh: '校验依赖完整性（node_modules）', vi: 'Kiểm tra tính đầy đủ của phụ thuộc (node_modules)' }, { zh: '不需要', vi: 'Không' }],
    [{ zh: '[3/6]', vi: '[3/6]' }, { zh: '检查构建产物（dist），缺失才构建', vi: 'Kiểm tra sản phẩm build (dist), chỉ build nếu thiếu' }, { zh: '不需要', vi: 'Không' }],
    [{ zh: '[4/6]', vi: '[4/6]' }, { zh: '【配置向导】询问数据库信息，生成 .env', vi: '【Trình hướng dẫn cấu hình】Hỏi thông tin CSDL, tạo .env', bold: true }, { zh: '需要（仅首次）', vi: 'Cần (chỉ lần đầu)', bold: true }],
    [{ zh: '[5/6]', vi: '[5/6]' }, { zh: '检测数据库连通性，首次自动建表建账号', vi: 'Kiểm tra kết nối CSDL, lần đầu tự tạo bảng và tài khoản' }, { zh: '不需要', vi: 'Không' }],
    [{ zh: '[6/6]', vi: '[6/6]' }, { zh: '启动服务，输出访问地址', vi: 'Khởi động dịch vụ, xuất địa chỉ truy cập' }, { zh: '不需要', vi: 'Không' }],
  ],
  { widths: [10, 62, 28] }
));

body.push(...callout('info',
  '启动器会主动检测问题并给出中文提示。例如数据库密码填错，它会明确告诉你「数据库连接失败」并列出四条排查方向，不会让你面对一堆技术报错。',
  'Bộ khởi động chủ động phát hiện vấn đề và đưa ra gợi ý bằng tiếng Trung. Ví dụ nếu mật khẩu CSDL sai, nó sẽ báo rõ "kết nối cơ sở dữ liệu thất bại" và liệt kê bốn hướng kiểm tra, không để bạn đối mặt với một đống lỗi kỹ thuật.'
));

body.push(...biHeading(2, '1.3  环境要求', '1.3  Yêu cầu môi trường'));

body.push(biTable(
  [
    { zh: '组件', vi: 'Thành phần' },
    { zh: '要求', vi: 'Yêu cầu' },
    { zh: '说明', vi: 'Mô tả' },
  ],
  [
    [{ zh: 'Node.js', vi: 'Node.js' }, { zh: '≥ 22.0.0（硬性）', vi: '≥ 22.0.0 (bắt buộc)', bold: true }, { zh: '唯一的运行环境依赖，无法打进包内，必须单独安装', vi: 'Phụ thuộc môi trường chạy duy nhất, không thể đóng gói, phải cài riêng' }],
    [{ zh: 'PostgreSQL', vi: 'PostgreSQL' }, { zh: '≥ 14（推荐 16 或 18）', vi: '≥ 14 (khuyến nghị 16 hoặc 18)' }, { zh: '数据存储，需提前安装并创建数据库', vi: 'Lưu trữ dữ liệu, cần cài trước và tạo CSDL' }],
    [{ zh: '操作系统', vi: 'Hệ điều hành' }, { zh: 'Windows Server 2019+ / Windows 10+', vi: 'Windows Server 2019+ / Windows 10+' }, { zh: '启动器为 Windows 批处理脚本', vi: 'Bộ khởi động là script batch Windows' }],
    [{ zh: '内存 / 磁盘', vi: 'RAM / Ổ cứng' }, { zh: '4 GB / 5 GB 可用空间', vi: '4 GB / 5 GB trống' }, { zh: '包本身约 550 MB', vi: 'Bản thân gói khoảng 550 MB' }],
  ],
  { widths: [18, 32, 50] }
));

body.push(...callout('err',
  'Node.js 是本版唯一无法内置的依赖。请务必先在目标服务器装好 Node.js 22 或更高版本，否则启动器第一步就会报错退出。',
  'Node.js là phụ thuộc duy nhất không thể tích hợp trong bản này. Nhất định phải cài Node.js 22 trở lên trên máy chủ đích trước, nếu không bộ khởi động sẽ báo lỗi và thoát ngay ở bước đầu tiên.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 2 章  部署操作步骤', 'Chương 2  Các bước triển khai'));

body.push(...biHeading(2, '2.1  第一步：安装 Node.js 22+', '2.1  Bước 1: Cài đặt Node.js 22+'));

body.push(...step('访问 https://nodejs.org/ 下载 Node.js 22 LTS 的 Windows 安装包（.msi）。',
  'Truy cập https://nodejs.org/ tải bộ cài Windows (.msi) của Node.js 22 LTS.'));
body.push(...step('双击安装，全部保持默认，务必勾选「Add to PATH」。',
  'Nháy đúp cài đặt, giữ mặc định toàn bộ, nhất định tích "Add to PATH".'));
body.push(...step('打开命令提示符（CMD），输入 node -v 验证，应输出 v22.x.x 或更高。',
  'Mở Command Prompt (CMD), nhập node -v để kiểm tra, kết quả phải là v22.x.x trở lên.'));

body.push(...codeBlock(['node -v', 'npm -v']));

body.push(...callout('warn',
  '若提示「不是内部或外部命令」，说明 PATH 未生效。重启命令行窗口，或重启电脑后重试。',
  'Nếu báo "không phải lệnh nội bộ", nghĩa là PATH chưa có hiệu lực. Khởi động lại cửa sổ dòng lệnh hoặc khởi động lại máy rồi thử lại.'
));

body.push(...biHeading(2, '2.2  第二步：拷贝部署包', '2.2  Bước 2: Sao chép gói triển khai'));

body.push(...step('把整个「WMS免安装版本」文件夹拷贝到目标服务器，例如 D:\\WMS。',
  'Sao chép toàn bộ thư mục "WMS免安装版本" sang máy chủ đích, ví dụ D:\\WMS.'));
body.push(...step('确认目录下有 node_modules（依赖）和 dist（构建产物）两个文件夹 —— 这两个是本版「免安装」的核心。',
  'Xác nhận trong thư mục có hai thư mục con node_modules (phụ thuộc) và dist (sản phẩm build) — đây là cốt lõi "cài đặt xanh" của bản này.'));

body.push(...callout('warn',
  '拷贝时请确保 node_modules 完整传输（文件数约 6.9 万个，体积约 520 MB）。若用网盘或压缩包传输，建议整体打包后传输再解压，避免丢文件。',
  'Khi sao chép hãy đảm bảo truyền đầy đủ node_modules (khoảng 69.000 tệp, dung lượng ~520 MB). Nếu truyền qua ổ đĩa mạng hoặc gói nén, nên nén toàn bộ rồi truyền và giải nén, tránh mất tệp.'
));

body.push(...biHeading(2, '2.3  第三步：准备数据库', '2.3  Bước 3: Chuẩn bị cơ sở dữ liệu'));

body.push(...biPair(
  '目标服务器需要有一个 PostgreSQL 数据库。若尚未创建，用任何客户端连接 PostgreSQL 后执行：',
  'Máy chủ đích cần có một cơ sở dữ liệu PostgreSQL. Nếu chưa tạo, dùng bất kỳ trình khách nào kết nối PostgreSQL rồi thực hiện:'
));

body.push(...codeBlock(['CREATE DATABASE wms;']));

body.push(...callout('info',
  '数据库名默认是 wms，可在配置向导中改成别的名字，但要与向导里填的保持一致。首次启动时会自动建表、建默认角色、建管理员账号，无需手工执行任何建表 SQL。',
  'Tên CSDL mặc định là wms, có thể đổi thành tên khác trong trình hướng dẫn, nhưng phải khớp với tên đã điền. Lần khởi động đầu sẽ tự tạo bảng, vai trò mặc định và tài khoản quản trị, không cần chạy thủ công bất kỳ câu SQL tạo bảng nào.'
));

body.push(...biHeading(2, '2.4  第四步：双击启动并填写配置', '2.4  Bước 4: Nháy đúp khởi động và điền cấu hình'));

body.push(...biPair(
  '双击目录下的「启动.bat」。前三个步骤是自动检查，第四步会进入配置向导。',
  'Nháy đúp "启动.bat" trong thư mục. Ba bước đầu là kiểm tra tự động, bước thứ tư sẽ vào trình hướng dẫn cấu hình.'
));

body.push(...biPair('向导先让你选择配置方式：', 'Trình hướng dẫn trước tiên cho bạn chọn cách cấu hình:'));
body.push(...codeBlock([
  '    [1] 交互式输入（推荐，逐项询问）',
  '    [2] 打开记事本手动编辑配置文件',
  '',
  '  直接回车 = 使用方式 1',
]));

body.push(...biPair(
  '方式 1（推荐）会逐项询问，直接回车即用括号内的默认值：',
  'Cách 1 (khuyến nghị) sẽ hỏi từng mục, nhấn Enter là dùng giá trị mặc định trong ngoặc:'
));
body.push(biTable(
  [
    { zh: '序号', vi: 'STT' },
    { zh: '询问内容', vi: 'Nội dung hỏi' },
    { zh: '默认值', vi: 'Mặc định' },
    { zh: '说明', vi: 'Mô tả' },
  ],
  [
    [{ zh: '1/6', vi: '1/6' }, { zh: '数据库地址', vi: 'Địa chỉ CSDL' }, { zh: 'localhost', vi: 'localhost' }, { zh: '数据库与应用同机填 localhost', vi: 'CSDL cùng máy với ứng dụng thì điền localhost' }],
    [{ zh: '2/6', vi: '2/6' }, { zh: '数据库端口', vi: 'Cổng CSDL' }, { zh: '5432', vi: '5432' }, { zh: 'PostgreSQL 默认端口', vi: 'Cổng mặc định PostgreSQL' }],
    [{ zh: '3/6', vi: '3/6' }, { zh: '数据库用户名', vi: 'Tên người dùng CSDL' }, { zh: 'postgres', vi: 'postgres' }, { zh: '超级用户', vi: 'Siêu người dùng' }],
    [{ zh: '4/6', vi: '4/6' }, { zh: '数据库名', vi: 'Tên CSDL' }, { zh: 'wms', vi: 'wms' }, { zh: '需与第三步创建的库名一致', vi: 'Phải khớp với tên CSDL đã tạo ở bước 3' }],
    [{ zh: '5/6', vi: '5/6' }, { zh: '服务端口', vi: 'Cổng dịch vụ' }, { zh: '3000', vi: '3000' }, { zh: 'HTTP 访问端口，被占用可改', vi: 'Cổng truy cập HTTP, có thể đổi nếu bị chiếm' }],
    [{ zh: '6/6', vi: '6/6' }, { zh: '数据库密码', vi: 'Mật khẩu CSDL' }, { zh: '（无默认）', vi: '(không có mặc định)', bold: true }, { zh: '【必填】目标服务器的 PostgreSQL 密码', vi: '【Bắt buộc】mật khẩu PostgreSQL của máy chủ đích', bold: true }],
  ],
  { widths: [8, 24, 20, 48] }
));

body.push(...biPair(
  '方式 2 会生成一个配置文件模板并自动用记事本打开，你只需要修改 DB_PASSWORD 这一行，保存关闭即可。',
  'Cách 2 sẽ tạo một mẫu tệp cấu hình và tự mở bằng Notepad, bạn chỉ cần sửa dòng DB_PASSWORD, lưu và đóng lại.'
));

body.push(...callout('ok',
  'JWT 登录密钥由启动器自动生成（48 字节随机），两种方式都不需要你操心，也建议不要手工改成简单字符串。',
  'Khóa đăng nhập JWT do bộ khởi động tự tạo (48 byte ngẫu nhiên), cả hai cách đều không cần bạn bận tâm, và cũng khuyến nghị không sửa thủ công thành chuỗi đơn giản.'
));

body.push(...callout('warn',
  '若向导里密码留空，启动器会自动改用记事本方式让你填写，不会让你卡住。填错密码则会在第五步报「数据库连接失败」并给出排查清单。',
  'Nếu để trống mật khẩu trong trình hướng dẫn, bộ khởi động tự chuyển sang cách dùng Notepad để bạn điền, không để bạn bị kẹt. Điền sai mật khẩu thì ở bước 5 sẽ báo "kết nối cơ sở dữ liệu thất bại" và đưa ra danh sách kiểm tra.'
));

body.push(...biHeading(2, '2.5  第五步：等待自动初始化', '2.5  Bước 5: Chờ tự động khởi tạo'));

body.push(...biPair(
  '配置完成后，启动器会自动检测数据库连通性。首次运行会自动完成建表、建默认角色、建管理员账号，全过程约 10–30 秒。看到「数据库初始化完成」即表示成功。',
  'Sau khi cấu hình xong, bộ khởi động tự kiểm tra kết nối CSDL. Lần chạy đầu sẽ tự động tạo bảng, tạo vai trò mặc định, tạo tài khoản quản trị, toàn bộ khoảng 10–30 giây. Thấy "khởi tạo cơ sở dữ liệu hoàn tất" là thành công.'
));

body.push(...biPair('成功时的关键输出：', 'Kết quả then chốt khi thành công:'));
body.push(...codeBlock([
  '[5/6] 检查数据库连接与结构...',
  '     数据库连接正常，当前已有 107 张表',
  '     数据库初始化完成。',
  '',
  '========================================',
  '  WMS 系统已启动',
  '  PC 端:   http://localhost:3000',
  '========================================',
], { bar: C.green, fill: C.okBg }));

body.push(...biHeading(2, '2.6  第六步：访问系统', '2.6  Bước 6: Truy cập hệ thống'));

body.push(biTable(
  [
    { zh: '终端', vi: 'Thiết bị' },
    { zh: '访问地址', vi: 'Địa chỉ truy cập' },
  ],
  [
    [{ zh: 'PC 端', vi: 'Máy tính để bàn' }, { zh: 'http://localhost:3000', vi: 'http://localhost:3000', mono: true }],
    [{ zh: 'PDA 端', vi: 'Thiết bị PDA' }, { zh: 'http://localhost:3000/pda/login', vi: 'http://localhost:3000/pda/login', mono: true }],
    [{ zh: '局域网其他电脑', vi: 'Máy khác trong mạng LAN' }, { zh: 'http://本机IP:3000', vi: 'http://IP_máy:3000', mono: true }],
    [{ zh: '证书下载页（PDA 扫码）', vi: 'Trang tải chứng chỉ (PDA quét mã)' }, { zh: 'http://本机IP:3000/cert', vi: 'http://IP_máy:3000/cert', mono: true }],
  ],
  { widths: [30, 70] }
));

body.push(...callout('err',
  '默认账号 admin / admin 仅供初始化使用。首次登录后请立即修改密码，生产环境继续使用默认密码存在严重安全风险。',
  'Tài khoản mặc định admin / admin chỉ dùng để khởi tạo. Sau lần đăng nhập đầu hãy đổi mật khẩu ngay, tiếp tục dùng mật khẩu mặc định trong sản xuất là rủi ro bảo mật nghiêm trọng.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 3 章  配置修改与日常运维', 'Chương 3  Sửa cấu hình và vận hành'));

body.push(...biHeading(2, '3.1  如何修改配置', '3.1  Cách sửa cấu hình'));

body.push(biTable(
  [
    { zh: '你想做什么', vi: 'Bạn muốn làm gì' },
    { zh: '操作方法', vi: 'Cách thao tác' },
  ],
  [
    [{ zh: '改数据库密码 / 地址 / 端口', vi: 'Đổi mật khẩu / địa chỉ / cổng CSDL' }, { zh: '删除 .env 文件，重新双击「启动.bat」，向导会重新询问', vi: 'Xóa tệp .env, nháy đúp lại "启动.bat", trình hướng dẫn sẽ hỏi lại' }],
    [{ zh: '只改某一项（不想重新走向导）', vi: 'Chỉ sửa một mục (không muốn chạy lại trình hướng dẫn)' }, { zh: '用记事本打开 .env，直接修改后保存', vi: 'Mở .env bằng Notepad, sửa trực tiếp rồi lưu' }],
    [{ zh: '改服务端口', vi: 'Đổi cổng dịch vụ' }, { zh: '编辑 .env 中的 SERVER_PORT', vi: 'Sửa SERVER_PORT trong .env' }],
    [{ zh: '关掉日志中的请求内容记录', vi: 'Tắt ghi nội dung yêu cầu trong log' }, { zh: '默认已关闭。如需开启，改 .env 中 LOG_REQUEST_BODY=true', vi: 'Mặc định đã tắt. Nếu cần bật, sửa LOG_REQUEST_BODY=true trong .env' }],
  ],
  { widths: [34, 66] }
));

body.push(...callout('info',
  '.env 是纯文本文件，可以用记事本直接编辑。修改保存后需要重启服务（关闭启动窗口，重新双击「启动.bat」）才会生效。',
  '.env là tệp văn bản thuần, có thể sửa trực tiếp bằng Notepad. Sau khi sửa và lưu cần khởi động lại dịch vụ (đóng cửa sổ khởi động, nháy đúp lại "启动.bat") mới có hiệu lực.'
));

body.push(...biHeading(2, '3.2  停止与重启服务', '3.2  Dừng và khởi động lại dịch vụ'));

body.push(biTable(
  [
    { zh: '操作', vi: 'Thao tác' },
    { zh: '方法', vi: 'Cách làm' },
  ],
  [
    [{ zh: '停止服务', vi: 'Dừng dịch vụ' }, { zh: '关闭启动器窗口（或按 Ctrl+C）', vi: 'Đóng cửa sổ bộ khởi động (hoặc nhấn Ctrl+C)' }],
    [{ zh: '重启服务', vi: 'Khởi động lại' }, { zh: '关闭窗口后重新双击「启动.bat」（依赖和构建已就绪，约 10 秒即可启动）', vi: 'Đóng cửa sổ rồi nháy đúp lại "启动.bat" (phụ thuộc và build đã sẵn, khoảng 10 giây là chạy)' }],
    [{ zh: '查看服务状态', vi: 'Xem trạng thái dịch vụ' }, { zh: '在命令行执行 netstat -ano | findstr 3000', vi: 'Chạy netstat -ano | findstr 3000 trong dòng lệnh', mono: true }],
  ],
  { widths: [26, 74] }
));

body.push(...callout('warn',
  '启动器窗口不能关闭。关闭窗口等于停止服务，客户端会立刻无法访问。如需长期后台运行，建议配合 Windows 计划任务实现开机自启（见 3.4 节）。',
  'Không được đóng cửa sổ bộ khởi động. Đóng cửa sổ nghĩa là dừng dịch vụ, máy khách sẽ lập tức không truy cập được. Nếu cần chạy nền lâu dài, khuyến nghị kết hợp Task Scheduler của Windows để tự khởi động (xem mục 3.4).'
));

body.push(...biHeading(2, '3.3  放行防火墙', '3.3  Mở tường lửa'));

body.push(...biPair(
  '局域网内其他电脑或 PDA 要访问，需要放行 3000 与 3443 端口。以管理员身份打开 PowerShell 执行：',
  'Để máy khác trong mạng LAN hoặc PDA truy cập được, cần mở cổng 3000 và 3443. Mở PowerShell bằng quyền quản trị và chạy:'
));

body.push(...codeBlock([
  'netsh advfirewall firewall add rule name="WMS-HTTP-3000" dir=in action=allow protocol=TCP localport=3000',
  'netsh advfirewall firewall add rule name="WMS-HTTPS-3443" dir=in action=allow protocol=TCP localport=3443',
]));

body.push(...callout('warn',
  '若服务器装了第三方安全软件（360、火绒、企业 EDR 等），也需在其中放行这两个端口，否则仍可能被拦截。',
  'Nếu máy chủ cài phần mềm bảo mật bên thứ ba (360, Huorong, EDR doanh nghiệp...), cũng cần mở hai cổng này trong đó, nếu không vẫn có thể bị chặn.'
));

body.push(...biHeading(2, '3.4  设置开机自启', '3.4  Cấu hình tự khởi động'));



body.push(...step('以管理员身份运行「任务计划程序」（taskschd.msc）。', 'Chạy "Task Scheduler" (taskschd.msc) bằng quyền quản trị.'));
body.push(...step('右侧点击「创建任务」（注意不是「创建基本任务」）。', 'Nháy "Create Task" bên phải (chú ý không phải "Create Basic Task").'));
body.push(...step('【常规】页：名称填 WMS-Server；勾选「不管用户是否登录都要运行」和「使用最高权限运行」。', 'Tab "General": đặt tên WMS-Server; tích "Run whether user is logged on or not" và "Run with highest privileges".'));
body.push(...step('【触发器】页：新建触发器 → 开始任务选「启动时」→ 确定。', 'Tab "Triggers": New → Begin the task chọn "At startup" → OK.'));
body.push(...step('【操作】页：新建操作 → 程序填「启动.bat」完整路径 → 起始于填部署目录（如 D:\\WMS）→ 确定。', 'Tab "Actions": New → Program điền đường dẫn đầy đủ của "启动.bat" → Start in điền thư mục triển khai (ví dụ D:\\WMS) → OK.'));
body.push(...step('保存时输入服务器管理员账号密码，完成后右键任务选「运行」测试一次。', 'Khi lưu nhập tài khoản/mật khẩu quản trị máy chủ, sau đó chuột phải task chọn "Run" để thử một lần.'));

body.push(...callout('warn',
  '「启动.bat」末尾有等待按键的语句，在计划任务中会导致任务一直不结束。若要用于开机自启，建议复制一份去掉最后的 pause 语句后再放进计划任务。',
  '"启动.bat" cuối có câu chờ nhấn phím, trong Task Scheduler sẽ khiến task không kết thúc. Nếu dùng để tự khởi động, nên sao chép một bản xóa câu pause cuối rồi mới đưa vào Task Scheduler.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 4 章  PDA 移动端配置', 'Chương 4  Cấu hình PDA'));

body.push(...biPair(
  'PDA 用于扫码收货、上架、拣货、发料等现场作业。本版与源码版共用同一套后端和数据库，PDA 配置方式一致。',
  'PDA dùng để quét mã nhận hàng, lên kệ, nhặt hàng, xuất kho tại hiện trường. Bản này dùng chung backend và CSDL với bản mã nguồn, cách cấu hình PDA giống nhau.'
));

body.push(biTable(
  [
    { zh: 'PDA 类型', vi: 'Loại PDA' },
    { zh: '访问地址', vi: 'Địa chỉ truy cập' },
    { zh: '是否需装证书', vi: 'Cần cài chứng chỉ?' },
  ],
  [
    [{ zh: '带扫描头的工业 PDA', vi: 'PDA công nghiệp có đầu quét' }, { zh: 'http://服务器IP:3000/pda/login', vi: 'http://IP_máy:3000/pda/login', mono: true }, { zh: '不需要', vi: 'Không' }],
    [{ zh: '普通安卓手机 / 平板', vi: 'Điện thoại / máy tính bảng Android thường' }, { zh: 'https://服务器IP:3443/pda/login', vi: 'https://IP_máy:3443/pda/login', mono: true }, { zh: '需要（首次）', vi: 'Cần (lần đầu)' }],
  ],
  { widths: [30, 46, 24] }
));

body.push(...biHeading(2, '4.1  安装 HTTPS 证书（普通安卓设备）', '4.1  Cài chứng chỉ HTTPS (thiết bị Android thường)'));

body.push(...biPair(
  '浏览器规定只有 HTTPS 才允许调用摄像头。若 PDA 要用自带摄像头扫码，需先安装证书：',
  'Trình duyệt quy định chỉ HTTPS mới cho gọi camera. Nếu PDA muốn dùng camera sẵn có để quét mã, cần cài chứng chỉ trước:'
));

body.push(...step('在 PDA 浏览器打开 http://服务器IP:3000/cert（HTTP 访问，无需证书）。', 'Mở http://IP_máy:3000/cert trong trình duyệt PDA (truy cập HTTP, không cần chứng chỉ).'));
body.push(...step('点击「下载证书」，保存 crt 文件。', 'Nháy "Tải chứng chỉ", lưu tệp crt.'));
body.push(...step('进入「设置 → 安全 → 凭据存储 / 安装证书 → CA 证书」，选择刚下载的文件安装。', 'Vào "Cài đặt → Bảo mật → Lưu trữ thông tin xác thực / Cài chứng chỉ → Chứng chỉ CA", chọn tệp vừa tải để cài.'));
body.push(...step('系统会要求设置锁屏密码，按提示设置；用途选「VPN 和应用」。', 'Hệ thống yêu cầu đặt mật khẩu khóa màn hình, làm theo hướng dẫn; mục đích chọn "VPN và ứng dụng".'));
body.push(...step('完成后用 https://服务器IP:3443/pda/login 访问，浏览器不再报警告即成功。', 'Sau khi xong truy cập https://IP_máy:3443/pda/login, trình duyệt không còn cảnh báo là thành công.'));

body.push(...callout('warn',
  '服务器局域网 IP 变化时（换网络、换路由器），系统会自动重新签发证书。此时所有 PDA 需重新执行本章步骤，否则 HTTPS 无法访问。',
  'Khi IP mạng LAN của máy chủ thay đổi (đổi mạng, đổi router), hệ thống sẽ tự cấp lại chứng chỉ. Lúc đó mọi PDA phải thực hiện lại các bước trong chương này, nếu không HTTPS không truy cập được.'
));

body.push(...callout('info',
  '建议在 PDA 的 Chrome 菜单里选「添加到主屏幕」，之后可像 App 一样全屏打开，无需每次输入网址。',
  'Khuyến nghị trong menu Chrome của PDA chọn "Thêm vào màn hình chính", sau đó mở toàn màn hình như App, không cần nhập địa chỉ mỗi lần.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 5 章  验收与故障排查', 'Chương 5  Nghiệm thu và xử lý sự cố'));

body.push(...biHeading(2, '5.1  部署验收清单', '5.1  Danh sách nghiệm thu triển khai'));

body.push(biTable(
  [
    { zh: '序号', vi: 'STT' },
    { zh: '检查项', vi: 'Hạng mục kiểm tra' },
    { zh: '验证方法', vi: 'Cách kiểm tra' },
    { zh: '预期结果', vi: 'Kết quả mong đợi' },
  ],
  [
    [{ zh: '1', vi: '1' }, { zh: 'Node.js 版本正确', vi: 'Phiên bản Node.js đúng' }, { zh: '命令行执行 node -v', vi: 'Chạy node -v trong dòng lệnh', mono: true }, { zh: '输出 v22.x.x 或更高', vi: 'Kết quả v22.x.x trở lên' }],
    [{ zh: '2', vi: '2' }, { zh: '启动器六步全过', vi: 'Sáu bước khởi động đều qua' }, { zh: '双击「启动.bat」观察', vi: 'Nháy đúp "启动.bat" quan sát' }, { zh: '[1/6] 到 [6/6] 依次通过', vi: '[1/6] đến [6/6] tuần tự đạt' }],
    [{ zh: '3', vi: '3' }, { zh: '数据库连接正常', vi: 'Kết nối CSDL bình thường' }, { zh: '观察 [5/6] 输出', vi: 'Quan sát kết quả [5/6]' }, { zh: '显示表数量，无报错', vi: 'Hiển thị số bảng, không lỗi' }],
    [{ zh: '4', vi: '4' }, { zh: 'HTTP 端口监听', vi: 'Cổng HTTP đang lắng nghe' }, { zh: 'netstat -ano | findstr 3000', vi: 'netstat -ano | findstr 3000', mono: true }, { zh: '出现 LISTENING', vi: 'Xuất hiện LISTENING' }],
    [{ zh: '5', vi: '5' }, { zh: 'HTTPS 端口监听', vi: 'Cổng HTTPS đang lắng nghe' }, { zh: 'netstat -ano | findstr 3443', vi: 'netstat -ano | findstr 3443', mono: true }, { zh: '出现 LISTENING', vi: 'Xuất hiện LISTENING' }],
    [{ zh: '6', vi: '6' }, { zh: 'PC 端可登录', vi: 'PC đăng nhập được' }, { zh: '浏览器访问，输入 admin/admin', vi: 'Truy cập trình duyệt, nhập admin/admin' }, { zh: '进入首页', vi: 'Vào trang chủ' }],
    [{ zh: '7', vi: '7' }, { zh: '中文显示正常', vi: 'Hiển thị tiếng Trung bình thường' }, { zh: '观察界面文字', vi: 'Quan sát chữ giao diện' }, { zh: '无乱码', vi: 'Không bị lỗi font' }],
    [{ zh: '8', vi: '8' }, { zh: '三语切换正常', vi: 'Chuyển 3 ngôn ngữ bình thường' }, { zh: '切换中文/越南文/英文', vi: 'Chuyển Trung/Việt/Anh' }, { zh: '界面文字同步变化', vi: 'Chữ giao diện thay đổi theo' }],
    [{ zh: '9', vi: '9' }, { zh: '局域网其他电脑可访问', vi: 'Máy khác trong LAN truy cập được' }, { zh: '同网段电脑访问服务器 IP', vi: 'Máy cùng dải mạng truy cập IP máy chủ' }, { zh: '正常打开', vi: 'Mở bình thường' }],
    [{ zh: '10', vi: '10' }, { zh: 'PDA 可访问扫码', vi: 'PDA truy cập và quét mã được' }, { zh: 'PDA 访问 /pda/login 并测试扫码', vi: 'PDA truy cập /pda/login và thử quét mã' }, { zh: '正常打开，扫码内容自动填入', vi: 'Mở bình thường, nội dung quét tự điền' }],
  ],
  { widths: [8, 28, 38, 26] }
));

body.push(...biHeading(2, '5.2  启动器报错处理', '5.2  Xử lý lỗi bộ khởi động'));

body.push(biTable(
  [
    { zh: '启动器提示', vi: 'Thông báo của bộ khởi động' },
    { zh: '原因与解决', vi: 'Nguyên nhân và cách xử lý' },
  ],
  [
    [
      { zh: '[1/6] 未检测到 Node.js / 版本过低', vi: '[1/6] Không phát hiện Node.js / phiên bản quá thấp' },
      { zh: '目标机器未装 Node.js 或版本低于 22。到 nodejs.org 安装 22 LTS 后重试。', vi: 'Máy đích chưa cài Node.js hoặc thấp hơn 22. Cài 22 LTS từ nodejs.org rồi thử lại.' },
    ],
    [
      { zh: '[2/6] 未找到 node_modules 目录', vi: '[2/6] Không tìm thấy thư mục node_modules' },
      { zh: '拷贝不完整。请重新完整拷贝整个目录，确认 node_modules 约 6.9 万个文件。', vi: 'Sao chép không đầy đủ. Sao chép lại toàn bộ thư mục, xác nhận node_modules khoảng 69.000 tệp.' },
    ],
    [
      { zh: '[5/6] 数据库连接失败', vi: '[5/6] Kết nối cơ sở dữ liệu thất bại' },
      { zh: '按启动器列出的四条排查：① PostgreSQL 是否启动 ② 密码/地址/端口是否正确 ③ wms 库是否已创建 ④ 防火墙是否放行 5432。改完后删除 .env 重新运行向导。', vi: 'Kiểm tra theo bốn hướng bộ khởi động liệt kê: ① PostgreSQL đã chạy chưa ② mật khẩu/địa chỉ/cổng đúng chưa ③ CSDL wms đã tạo chưa ④ tường lửa mở 5432 chưa. Sửa xong xóa .env và chạy lại trình hướng dẫn.' },
    ],
    [
      { zh: '数据库初始化失败', vi: 'Khởi tạo cơ sở dữ liệu thất bại' },
      { zh: '通常是数据库连上了但权限不足，或库不存在。检查 .env 中的库名，确认已执行 CREATE DATABASE wms。', vi: 'Thường là kết nối CSDL được nhưng quyền không đủ, hoặc CSDL chưa tồn tại. Kiểm tra tên CSDL trong .env, xác nhận đã chạy CREATE DATABASE wms.' },
    ],
    [
      { zh: '[6/6] 端口被占用 EADDRINUSE', vi: '[6/6] Cổng bị chiếm EADDRINUSE' },
      { zh: '3000 端口已被其他程序占用。删除 .env 重新运行向导并填写其他端口（如 8080），或结束占用进程。', vi: 'Cổng 3000 đã bị chương trình khác chiếm. Xóa .env chạy lại trình hướng dẫn và điền cổng khác (như 8080), hoặc kết thúc tiến trình đang chiếm.' },
    ],
  ],
  { widths: [34, 66] }
));

body.push(...biHeading(2, '5.3  使用中的常见问题', '5.3  Sự cố thường gặp khi sử dụng'));

body.push(biTable(
  [
    { zh: '现象', vi: 'Hiện tượng' },
    { zh: '原因', vi: 'Nguyên nhân' },
    { zh: '解决', vi: 'Cách xử lý' },
  ],
  [
    [
      { zh: '页面能开但接口全部报错', vi: 'Mở được trang nhưng mọi API đều báo lỗi' },
      { zh: '数据库连接中断或密码被改', vi: 'Kết nối CSDL bị ngắt hoặc mật khẩu bị đổi' },
      { zh: '检查 .env 数据库配置，用「数据库连接正常」的判断方法排查', vi: 'Kiểm tra cấu hình CSDL trong .env, dùng cách kiểm tra "kết nối CSDL bình thường" để tìm lỗi' },
    ],
    [
      { zh: '局域网其他电脑打不开', vi: 'Máy khác trong LAN không mở được' },
      { zh: '防火墙未放行，或服务未监听 0.0.0.0', vi: 'Tường lửa chưa mở, hoặc dịch vụ chưa lắng nghe 0.0.0.0' },
      { zh: '按 3.3 节放行端口；确认 .env 中 SERVER_HOST=0.0.0.0', vi: 'Mở cổng theo mục 3.3; xác nhận SERVER_HOST=0.0.0.0 trong .env' },
    ],
    [
      { zh: 'PDA 摄像头无法调用', vi: 'Camera PDA không gọi được' },
      { zh: '未使用 HTTPS 访问', vi: 'Chưa truy cập qua HTTPS' },
      { zh: '改用 https://IP:3443/pda/login，并按 4.1 节装证书', vi: 'Đổi sang https://IP:3443/pda/login, cài chứng chỉ theo mục 4.1' },
    ],
    [
      { zh: 'HTTPS 提示证书不受信任', vi: 'HTTPS báo chứng chỉ không đáng tin' },
      { zh: '服务器 IP 变化导致证书重签', vi: 'IP máy chủ thay đổi khiến chứng chỉ được ký lại' },
      { zh: '重新访问 /cert 下载安装新证书', vi: 'Truy cập lại /cert tải và cài chứng chỉ mới' },
    ],
    [
      { zh: '页面显示 xxx.yyy 形式的键名', vi: 'Trang hiển thị tên khóa dạng xxx.yyy' },
      { zh: '前端语言包缺少翻译键', vi: 'Gói ngôn ngữ frontend thiếu khóa dịch' },
      { zh: '联系开发人员补充 client/src/i18n/locales 下的语言包', vi: 'Liên hệ lập trình viên bổ sung gói ngôn ngữ ở client/src/i18n/locales' },
    ],
    [
      { zh: '改了配置但没生效', vi: 'Sửa cấu hình nhưng không có hiệu lực' },
      { zh: '服务未重启', vi: 'Dịch vụ chưa khởi động lại' },
      { zh: '关闭启动窗口，重新双击「启动.bat」', vi: 'Đóng cửa sổ khởi động, nháy đúp lại "启动.bat"' },
    ],
  ],
  { widths: [26, 28, 46] }
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 6 章  注意事项与数据备份', 'Chương 6  Lưu ý và sao lưu dữ liệu'));

body.push(...biHeading(2, '6.1  六条重要注意事项', '6.1  Sáu lưu ý quan trọng'));

body.push(...bullet('node_modules 与 dist 两个目录不可删除 —— 这是本版「免安装」的核心，删掉就要重新联网安装和构建。',
  'Không được xóa hai thư mục node_modules và dist — đây là cốt lõi "cài đặt xanh" của bản này, xóa rồi phải cài lại và build lại qua mạng.'));
body.push(...bullet('不建议跨操作系统直接复制 node_modules。若目标机器与本机系统或 Node 版本差异较大，可能出现原生模块不兼容，此时在目标机器执行一次 npm install 即可修复。',
  'Không khuyến nghị sao chép trực tiếp node_modules qua hệ điều hành khác. Nếu máy đích khác biệt nhiều về hệ thống hoặc phiên bản Node, có thể xảy ra không tương thích module gốc, lúc đó chạy một lần npm install trên máy đích là khắc phục được.'));
body.push(...bullet('.env 文件包含数据库密码和登录密钥，不要提交到代码仓库、不要通过微信或邮件随意传输，建议单独备份保管。',
  'Tệp .env chứa mật khẩu CSDL và khóa đăng nhập, không đưa lên kho mã, không truyền tùy tiện qua WeChat hay email, nên sao lưu và bảo quản riêng.'));
body.push(...bullet('服务器请使用固定 IP。否则重启后 IP 变化，所有客户端和 PDA 都要重新配置访问地址。',
  'Máy chủ nên dùng IP tĩnh. Nếu không, sau khi khởi động lại IP thay đổi, mọi máy khách và PDA đều phải cấu hình lại địa chỉ.'));
body.push(...bullet('启动器窗口不能关闭，关闭即停止服务。长期运行建议配置开机自启（见 3.4 节）。',
  'Không được đóng cửa sổ bộ khởi động, đóng là dừng dịch vụ. Chạy lâu dài nên cấu hình tự khởi động (xem mục 3.4).'));
body.push(...bullet('首次登录后立即修改管理员密码。默认 admin / admin 仅供初始化使用。',
  'Đổi mật khẩu quản trị ngay sau lần đăng nhập đầu. Mặc định admin / admin chỉ dùng để khởi tạo.'));

body.push(...biHeading(2, '6.2  数据备份', '6.2  Sao lưu dữ liệu'));

body.push(...biPair(
  '数据库是系统最核心的资产，强烈建议配置每日自动备份（本版与源码版数据完全一致，备份方法相同）。',
  'Cơ sở dữ liệu là tài sản cốt lõi nhất, rất khuyến nghị cấu hình sao lưu tự động hàng ngày (dữ liệu bản này hoàn toàn giống bản mã nguồn, cách sao lưu như nhau).'
));

body.push(...biPair('Windows 备份命令（保存为 backup.bat，配合计划任务每日执行）：',
  'Lệnh sao lưu Windows (lưu thành backup.bat, kết hợp Task Scheduler chạy hàng ngày):'));

body.push(...codeBlock([
  '@echo off',
  'chcp 936 >nul',
  'set BACKUP_DIR=D:\\WMS\\backups',
  'set STAMP=%date:~0,4%%date:~5,2%%date:~8,2%',
  'set PGPASSWORD=你的数据库密码',
  '',
  '"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe" -U postgres -d wms -F c -f "%BACKUP_DIR%\\wms_%STAMP%.dump"',
  '',
  'echo 备份完成: %BACKUP_DIR%\\wms_%STAMP%.dump',
]));

body.push(...callout('warn',
  'pg_dump 需要数据库密码。脚本中必须设置 PGPASSWORD 环境变量（如上），否则计划任务会因等待密码输入而挂起。',
  'pg_dump cần mật khẩu CSDL. Trong script phải đặt biến môi trường PGPASSWORD (như trên), nếu không Task Scheduler sẽ treo vì chờ nhập mật khẩu.'
));

body.push(...biPair('恢复备份（数据损坏或迁移时使用）：', 'Phục hồi sao lưu (dùng khi dữ liệu hỏng hoặc di chuyển):'));
body.push(...codeBlock([
  '# 1. 停止服务（关闭启动窗口）',
  '# 2. 创建新库并恢复',
  'createdb -U postgres wms_restore',
  'pg_restore -U postgres -d wms_restore -F c wms_20261008.dump',
  '# 3. 修改 .env 中 DB_NAME=wms_restore 后重启验证',
]));

body.push(...biHeading(2, '6.3  版本升级', '6.3  Nâng cấp phiên bản'));

body.push(...biPair(
  '本版升级最简单：用新版免安装目录整体替换旧目录即可。但务必注意以下几点：',
  'Nâng cấp bản này đơn giản nhất: dùng thư mục bản cài đặt xanh mới thay thế toàn bộ thư mục cũ. Nhưng nhất định chú ý các điểm sau:'
));

body.push(...step('升级前先备份数据库（见 6.2 节）。', 'Sao lưu CSDL trước khi nâng cấp (xem mục 6.2).'));
body.push(...step('停止旧服务（关闭启动窗口）。', 'Dừng dịch vụ cũ (đóng cửa sổ khởi động).'));
body.push(...step('把旧目录中的 .env 文件复制到新目录（保留你的数据库配置）。', 'Sao chép tệp .env từ thư mục cũ sang thư mục mới (giữ cấu hình CSDL của bạn).'));
body.push(...step('如新版本带有数据库结构变更脚本（server/database 下的 .sql 文件），按文件名顺序手工执行。', 'Nếu bản mới có script thay đổi cấu trúc CSDL (tệp .sql trong server/database), thực hiện thủ công theo thứ tự tên tệp.'));
body.push(...step('用新目录替换旧目录，双击「启动.bat」验证。', 'Thay thế thư mục cũ bằng thư mục mới, nháy đúp "启动.bat" để kiểm tra.'));
body.push(...step('若出现问题无法快速修复，回滚：恢复旧目录 + 恢复数据库备份。', 'Nếu có sự cố không sửa nhanh được, khôi phục: phục hồi thư mục cũ + phục hồi bản sao CSDL.'));

body.push(...callout('info',
  '系统未使用数据库迁移框架，结构变更通过 server/database 目录下的 .sql 文件手工执行。升级前请向开发人员确认是否需要执行相关 SQL。',
  'Hệ thống không dùng framework migration CSDL, thay đổi cấu trúc thực hiện thủ công qua tệp .sql trong server/database. Trước khi nâng cấp hãy xác nhận với lập trình viên có cần chạy SQL liên quan không.'
));

// ---------- 附录 ----------
body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));
body.push(...biHeading(1, '附录  速查卡', 'Phụ lục  Thẻ tra cứu nhanh'));

body.push(...biHeading(2, 'A.1  部署三句话', 'A.1  Ba câu tóm tắt triển khai'));

body.push(...biPair('若你已经很熟悉，记住这三句就够了：', 'Nếu bạn đã quen, chỉ cần nhớ ba câu này:'));
body.push(...bullet('装 Node.js 22+（唯一需要手动装的）。', 'Cài Node.js 22+ (thứ duy nhất cần cài thủ công).'));
body.push(...bullet('建一个名为 wms 的 PostgreSQL 数据库。', 'Tạo một CSDL PostgreSQL tên wms.'));
body.push(...bullet('双击「启动.bat」，按向导填数据库密码。', 'Nháy đúp "启动.bat", điền mật khẩu CSDL theo trình hướng dẫn.'));

body.push(...biHeading(2, 'A.2  启动器流程速查', 'A.2  Tra cứu nhanh luồng bộ khởi động'));

body.push(...codeBlock([
  '[1/6] 校验 Node.js 版本 (>=22)',
  '[2/6] 校验 node_modules 依赖完整性',
  '[3/6] 检查 dist 构建产物（缺失才构建）',
  '[4/6] 配置向导  --> 生成 .env',
  '        [1] 交互式输入  [2] 记事本编辑',
  '        询问: 地址/端口/用户/库名/服务端口/密码',
  '        自动生成 48 字节随机 JWT 密钥',
  '[5/6] 数据库连通性检测 --> 首次自动建表建账号',
  '[6/6] 启动服务 --> http://localhost:3000',
]));

body.push(...biHeading(2, 'A.3  目录与文件速查', 'A.3  Tra cứu nhanh thư mục và tệp'));

body.push(biTable(
  [
    { zh: '条目', vi: 'Mục' },
    { zh: '说明', vi: 'Mô tả' },
  ],
  [
    [{ zh: '启动.bat', vi: '启动.bat', mono: true, bold: true }, { zh: '免安装版专用启动器（推荐使用），含配置向导', vi: 'Bộ khởi động riêng bản cài đặt xanh (khuyến nghị), có trình hướng dẫn cấu hình' }],
    [{ zh: 'node_modules/', vi: 'node_modules/', mono: true }, { zh: '内置的全部依赖（约 520 MB），勿删', vi: 'Toàn bộ phụ thuộc tích hợp (khoảng 520 MB), không xóa' }],
    [{ zh: 'dist/', vi: 'dist/', mono: true }, { zh: '已构建的前后端产物（后端入口 dist/main.js），勿删', vi: 'Sản phẩm build frontend/backend (điểm vào backend dist/main.js), không xóa' }],
    [{ zh: '.env', vi: '.env', mono: true }, { zh: '环境变量配置，首次由向导生成，可手动编辑', vi: 'Cấu hình biến môi trường, lần đầu do trình hướng dẫn tạo, có thể sửa thủ công' }],
    [{ zh: 'README.md', vi: 'README.md', mono: true }, { zh: '简要说明文档', vi: 'Tài liệu mô tả ngắn gọn' }],
    [{ zh: 'ssl/', vi: 'ssl/', mono: true }, { zh: 'HTTPS 自签证书（PDA 扫码用，IP 变化自动重签）', vi: 'Chứng chỉ HTTPS tự ký (dùng cho PDA quét mã, IP đổi thì tự ký lại)' }],
    [{ zh: 'server/database/*.sql', vi: 'server/database/*.sql', mono: true }, { zh: '数据库结构变更脚本（升级时手工执行）', vi: 'Script thay đổi cấu trúc CSDL (chạy thủ công khi nâng cấp)' }],
    [{ zh: '启动.bat（配置状态标记）', vi: '启动.bat (dấu trạng thái cấu hình)' }, { zh: 'node_modules/.db-initialized 存在表示已初始化过数据库', vi: 'node_modules/.db-initialized tồn tại nghĩa là đã khởi tạo CSDL' }],
  ],
  { widths: [32, 68] }
));

body.push(...biHeading(2, 'A.4  与源码版的关系', 'A.4  Quan hệ với bản mã nguồn'));

body.push(...biPair(
  '免安装版与源码部署版是同一套程序的两种打包形式，数据库结构、接口、功能完全相同，可以互相切换。',
  'Bản cài đặt xanh và bản triển khai từ mã nguồn là hai hình thức đóng gói của cùng một chương trình, cấu trúc CSDL, API, tính năng hoàn toàn giống nhau, có thể chuyển đổi qua lại.'
));

body.push(biTable(
  [
    { zh: '需求', vi: 'Nhu cầu' },
    { zh: '推荐版本', vi: 'Phiên bản khuyến nghị' },
  ],
  [
    [{ zh: '内网隔离环境部署', vi: 'Triển khai môi trường mạng nội bộ cô lập' }, { zh: '免安装版（本版）', vi: 'Bản cài đặt xanh (bản này)' }],
    [{ zh: '快速交付演示', vi: 'Bàn giao demo nhanh' }, { zh: '免安装版（本版）', vi: 'Bản cài đặt xanh (bản này)' }],
    [{ zh: '需要改代码后重新部署', vi: 'Cần sửa mã rồi triển khai lại' }, { zh: '源码版', vi: 'Bản mã nguồn' }],
    [{ zh: '需要干净环境从头构建', vi: 'Cần môi trường sạch build từ đầu' }, { zh: '源码版', vi: 'Bản mã nguồn' }],
  ],
  { widths: [46, 54] }
));

body.push(spacer(280));
body.push(...callout('ok',
  '本指导书覆盖了免安装版的完整部署流程。如遇到本文未涉及的问题，请记录完整的报错信息与复现步骤，反馈给系统开发人员。',
  'Tài liệu này bao quát toàn bộ quy trình triển khai bản cài đặt xanh. Nếu gặp vấn đề chưa đề cập, vui lòng ghi lại thông tin lỗi đầy đủ và các bước tái hiện, phản hồi cho lập trình viên hệ thống.'
));

// ============================================================
const doc = new Document({
  creator: 'WMS 项目组',
  title: 'WMS 免安装版本地服务器部署操作指导书（中越双语）',
  description: 'Hướng dẫn triển khai bản cài đặt xanh WMS trên máy chủ nội bộ',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { line: 300 } } },
      heading1: { run: { font: FONT, size: 32, bold: true, color: C.brand } },
      heading2: { run: { font: FONT, size: 26, bold: true, color: C.brand } },
      heading3: { run: { font: FONT, size: 23, bold: true, color: C.accent } },
      heading4: { run: { font: FONT, size: 21, bold: true, color: '333333' } },
    },
  },
  numbering: {
    config: [
      {
        reference: 'wms-bullet',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '\u25CF', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertMillimetersToTwip(8), hanging: convertMillimetersToTwip(4) } }, run: { size: 14, color: C.brand } } },
          { level: 1, format: LevelFormat.BULLET, text: '\u25CB', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertMillimetersToTwip(14), hanging: convertMillimetersToTwip(4) } }, run: { size: 14, color: C.accent } } },
        ],
      },
      {
        reference: 'wms-step',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertMillimetersToTwip(9), hanging: convertMillimetersToTwip(5) } }, run: { bold: true, color: C.brand } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: { margin: { top: convertMillimetersToTwip(22), bottom: convertMillimetersToTwip(20), left: convertMillimetersToTwip(20), right: convertMillimetersToTwip(20) } },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT, spacing: { after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 2 } },
          children: [t('WMS 免安装版部署指导书 · Hướng dẫn triển khai bản cài đặt xanh WMS', { size: 16, color: C.gray })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 0 },
          children: [
            t('第 ', { size: 16, color: C.gray }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.gray, font: FONT }),
            t(' 页 / Trang  共 ', { size: 16, color: C.gray }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: C.gray, font: FONT }),
            t(' 页 · Trang', { size: 16, color: C.gray }),
          ],
        })],
      }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const outPath = path.resolve(OUT);
  fs.writeFileSync(outPath, buf);
  console.log('OK ->', outPath);
  console.log('size =', (buf.length / 1024).toFixed(1), 'KB');
});
