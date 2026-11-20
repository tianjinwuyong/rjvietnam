/**
 * 生成《WMS 系统本地服务器部署操作指导书》中越双语 Word 文档
 * 临时脚本，生成后自行删除
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak, Footer, Header, PageNumber, NumberFormat, convertInchesToTwip,
  TableOfContents, LevelFormat, convertMillimetersToTwip,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ---------- 输出语言开关 ----------
// 加 --zh  = 纯中文版（去掉全部越南文）
// 不加     = 中越双语版（默认，行为与历史一致）
// 双语版随时可用本脚本重新生成，不会被中文版覆盖掉。
const ZH_ONLY = process.argv.includes('--zh');
const __args = process.argv.slice(2).filter((a) => a !== '--zh');
const OUT =
  __args[0] ||
  (ZH_ONLY
    ? 'WMS系统本地服务器部署操作指导书_中文版.docx'
    : 'WMS系统本地服务器部署操作指导书_中越双语.docx');

// ---------- 主题色 ----------
const C = {
  brand: '1F4E79',      // 深蓝 主色
  brandLight: 'DEEAF6', // 浅蓝底纹
  accent: 'C55A11',     // 橙 强调
  warnBg: 'FFF2CC',     // 浅黄 警告
  okBg: 'E2EFDA',       // 浅绿 正确
  errBg: 'FCE4E4',      // 浅红 错误
  gray: '595959',
  codeBg: 'F2F2F2',
  vi: '7F6000',         // 越南文标签色（深棕）
  tableHead: '1F4E79',
};

const FONT = 'Microsoft YaHei';
const FONT_CODE = 'Consolas';

// ---------- 基础构造器 ----------
const t = (text, opt = {}) => new TextRun({
  text, font: opt.font || FONT,
  size: opt.size || 21,           // 10.5pt
  bold: !!opt.bold, italics: !!opt.italics,
  color: opt.color || '000000',
  break: opt.break,
});

// 中文段 + 越南文段 成对
function biPair(zhText, viText, opt = {}) {
  viText = ZH_ONLY ? '' : viText; // 纯中文模式：跳过越南文段（间距逻辑随之走“无越南文”分支）
  const out = [];
  out.push(new Paragraph({
    spacing: { before: opt.beforeZh ?? 60, after: 20, line: 300 },
    children: opt.zhRuns || [t(zhText, { size: opt.size })],
  }));
  if (viText) {
    out.push(new Paragraph({
      spacing: { before: 0, after: opt.afterVi ?? 120, line: 300 },
      indent: { left: convertMillimetersToTwip(2) },
      children: [
        t('VI  ', { color: C.vi, bold: true, size: (opt.size || 21) - 2 }),
        t(viText, { italics: true, size: opt.size, color: '333333' }),
      ],
    }));
  }
  return out;
}

// 标题（中越双语，中文为主标题，越南文为副标题）
function biHeading(level, zhText, viText, opt = {}) {
  viText = ZH_ONLY ? '' : viText; // 纯中文模式：标题下不再输出越南文副标题
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
  if (viText) {
    out.push(new Paragraph({
      spacing: { before: 0, after: 140 },
      children: [t(viText, { bold: level <= 2, size: sizes[level] - 5, color: C.gray })],
    }));
  }
  return out;
}

// 项目符号
function bullet(zhText, viText, opt = {}) {
  viText = ZH_ONLY ? '' : viText; // 纯中文模式：项目符号只输出中文
  const out = [new Paragraph({
    numbering: { reference: 'wms-bullet', level: opt.level || 0 },
    spacing: { before: 40, after: viText ? 0 : 80, line: 290 },
    children: opt.zhRuns || [t(zhText, { size: opt.size })],
  })];
  if (viText) {
    out.push(new Paragraph({
      numbering: { reference: 'wms-bullet', level: opt.level || 0 },
      spacing: { before: 0, after: 80, line: 290 },
      children: [t(viText, { italics: true, size: (opt.size || 21) - 2, color: '555555' })],
    }));
  }
  return out;
}

// 有序步骤
// 编号只打在中文步骤行上；越南文译文行不编号（它是同一步骤的译文）。
// 每个连续的步骤列表使用独立的 numbering instance，编号各自从 1 开始；
// 列表边界由下方 body.push 包装器识别（见「步骤列表独立编号」一节）。
function step(zhText, viText, opt = {}) {
  viText = ZH_ONLY ? '' : viText; // 纯中文模式：步骤只输出中文行（编号逻辑不受影响）
  const ref = opt.ref || 'wms-step';
  if (__lastPushStepRef !== ref) {
    __stepListSeq += 1;
    __currentStepList = __stepListSeq;
  }
  const out = [new Paragraph({
    numbering: { reference: ref, level: 0, instance: __currentStepList },
    spacing: { before: 60, after: viText ? 0 : 100, line: 300 },
    children: opt.zhRuns || [t(zhText, { size: opt.size })],
  })];
  if (viText) {
    out.push(new Paragraph({
      spacing: { before: 0, after: 100, line: 300 },
      indent: { left: convertMillimetersToTwip(9) },
      children: [t(viText, { italics: true, size: (opt.size || 21) - 2, color: '555555' })],
    }));
  }
  for (const p of out) p.__wmsStepRef = ref;
  return out;
}

// 代码块（多行）
function codeBlock(lines, opt = {}) {
  const arr = Array.isArray(lines) ? lines : String(lines).split('\n');
  return arr.map((ln, i) => new Paragraph({
    spacing: { before: i === 0 ? 80 : 0, after: i === arr.length - 1 ? 140 : 0, line: 260 },
    shading: { type: ShadingType.CLEAR, fill: opt.fill || C.codeBg },
    indent: { left: convertMillimetersToTwip(3), right: convertMillimetersToTwip(1) },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: opt.bar || C.brand, space: 6 },
    },
    children: [t(ln || ' ', { font: FONT_CODE, size: 18, color: opt.color || '1A1A1A' })],
  }));
}

// 提示框
function callout(kind, zhText, viText) {
  viText = ZH_ONLY ? '' : viText; // 纯中文模式：提示框只输出中文
  const icons = ZH_ONLY
    ? { info: '提示', warn: '注意', ok: '正确', err: '错误' }
    : { info: '提示 / Ghi chú', warn: '注意 / Cảnh báo', ok: '正确 / Đúng', err: '错误 / Sai' };
  const map = {
    info: { bg: C.brandLight, bar: C.brand, icon: icons.info },
    warn: { bg: C.warnBg, bar: 'BF8F00', icon: icons.warn },
    ok: { bg: C.okBg, bar: '538135', icon: icons.ok },
    err: { bg: C.errBg, bar: 'C00000', icon: icons.err },
  }[kind];
  const out = [new Paragraph({
    spacing: { before: 100, after: 0, line: 290 },
    shading: { type: ShadingType.CLEAR, fill: map.bg },
    indent: { left: convertMillimetersToTwip(2) },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: map.bar, space: 6 } },
    children: [
      t(map.icon + '：', { bold: true, size: 20, color: map.bar }),
      t(zhText, { size: 20 }),
    ],
  })];
  if (viText) {
    out.push(new Paragraph({
      spacing: { before: 0, after: 100, line: 290 },
      shading: { type: ShadingType.CLEAR, fill: map.bg },
      indent: { left: convertMillimetersToTwip(2) },
      border: { left: { style: BorderStyle.SINGLE, size: 20, color: map.bar, space: 6 } },
      children: [t(viText, { italics: true, size: 18, color: '404040' })],
    }));
  }
  return out;
}

// 表格：headers = [{zh, vi}], rows = [[{zh,vi}, ...]]
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
      const zh = content.zh ?? '';
      const vi = ZH_ONLY ? '' : (content.vi ?? ''); // 纯中文模式：表格单元格只保留中文
      paras.push(new Paragraph({
        spacing: { before: 30, after: vi ? 0 : 30, line: 270 },
        children: (content.zhRuns) || [t(zh, { size: 19, bold: isHead || content.bold, color: isHead ? 'FFFFFF' : '000000', font: content.mono ? FONT_CODE : undefined })],
      }));
      if (vi) paras.push(new Paragraph({
        spacing: { before: 0, after: 30, line: 260 },
        children: [t(vi, { italics: true, size: 17, color: isHead ? 'E8F0F8' : '555555' })],
      }));
    }
    return new TableCell({
      borders: cellBorders,
      shading: isHead ? { type: ShadingType.CLEAR, fill: C.tableHead } : (opt.zebra ? undefined : undefined),
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
      children: paras,
    });
  };

  const headRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => {
      const w = opt.widths ? opt.widths[headers.indexOf(h)] : undefined;
      return mkCell({ zh: h.zh, vi: h.vi }, true, w);
    }),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((c, ci) => mkCell(c, false, opt.widths ? opt.widths[ci] : undefined)),
  }));

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

function spacer(h = 100) {
  return new Paragraph({ spacing: { before: 0, after: h }, children: [t('')] });
}

// ============================================================
//            文档正文
// ============================================================
const body = [];

// ---------- 步骤列表独立编号 ----------
// step() 生成的中文步骤段落带 __wmsStepRef 标记。这里包装 body.push：
// 若本次压入的内容全是同一种步骤段落，说明仍在同一个步骤列表中（沿用同一 instance）；
// 否则视为列表结束，下一批 step() 会开启新的 instance，编号重新从 1 开始。
let __stepListSeq = 0;
let __currentStepList = 0;
let __lastPushStepRef = null;
const __rawBodyPush = body.push.bind(body);
body.push = (...items) => {
  const allStep = items.length > 0 && items.every((x) => x && x.__wmsStepRef !== undefined);
  __lastPushStepRef = allStep ? items[0].__wmsStepRef : null;
  return __rawBodyPush(...items);
};

// ---------- 封面 ----------
body.push(
  spacer(1400),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: ZH_ONLY ? 460 : 120 },
    children: [t('WMS 仓库管理系统', { bold: true, size: 52, color: C.brand })],
  }),
  // ↓ 越南文副标题：纯中文模式不输出，并把间距并入上一段
  ...(ZH_ONLY ? [] : [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 400 },
    children: [t('HỆ THỐNG QUẢN LÝ KHO WMS', { bold: true, size: 26, color: C.gray })],
  })]),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: ZH_ONLY ? 760 : 100 },
    children: [t('本地服务器部署操作指导书', { bold: true, size: 36, color: '000000' })],
  }),
  // ↓ 越南文副标题：纯中文模式不输出
  ...(ZH_ONLY ? [] : [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 700 },
    children: [t('HƯỚNG DẪN TRIỂN KHAI TRÊN MÁY CHỦ NỘI BỘ', { bold: true, size: 22, color: C.accent })],
  })]),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: ZH_ONLY ? 620 : 80 },
    children: [t('适用版本：WMS 单机部署版（NestJS + React + PostgreSQL）', { size: 20, color: C.gray })],
  }),
  // ↓ 越南文副标题：纯中文模式不输出
  ...(ZH_ONLY ? [] : [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [t('Phiên bản: WMS bản triển khai độc lập (NestJS + React + PostgreSQL)', { italics: true, size: 18, color: C.gray })],
  })]),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 0 },
    children: [t('文档版本 V1.2   ·   修订日期 ' + new Date().toISOString().slice(0, 10), { size: 18, color: C.gray })],
  }),
  // ↓ 越南文副标题：纯中文模式不输出
  ...(ZH_ONLY ? [] : [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 0 },
    children: [t('Phiên bản tài liệu V1.2 · Ngày sửa đổi ' + new Date().toISOString().slice(0, 10), { italics: true, size: 16, color: C.gray })],
  })]),
  new Paragraph({ pageBreakBefore: true, children: [t('')] }),
);

// ---------- 目录 ----------
body.push(
  ...biHeading(1, '目录', 'Mục lục'),
  new TableOfContents('WMS-TOC', { hyperlink: true, headingStyleRange: '1-3' }),
  new Paragraph({ pageBreakBefore: true, children: [t('')] }),
);

// ============================================================
body.push(...biHeading(1, '第 1 章  部署前准备', 'Chương 1  Chuẩn bị trước khi triển khai'));

body.push(...biPair(
  '本章说明部署 WMS 系统前需要了解的系统架构、服务器硬件要求和软件依赖。请先完整阅读本章，再进入后续章节操作。',
  'Chương này giới thiệu kiến trúc hệ thống, yêu cầu phần cứng máy chủ và các phần mềm phụ thuộc cần có trước khi triển khai WMS. Vui lòng đọc kỹ chương này trước khi thực hiện các bước tiếp theo.'
));

body.push(...biHeading(2, '1.1  系统架构说明', '1.1  Kiến trúc hệ thống'));

body.push(...biPair(
  'WMS 采用「单进程一体化」部署模式：一个 Node.js 进程同时提供后端 API 接口和前端静态页面。因此只需要在服务器上启动一个服务，客户端浏览器即可访问全部功能。',
  'WMS sử dụng mô hình triển khai "tích hợp một tiến trình": một tiến trình Node.js vừa cung cấp API backend vừa phục vụ trang tĩnh frontend. Do đó chỉ cần khởi động một dịch vụ trên máy chủ, trình duyệt của khách hàng có thể truy cập toàn bộ chức năng.'
));

body.push(biTable(
  [
    { zh: '层次', vi: 'Tầng' },
    { zh: '技术', vi: 'Công nghệ' },
    { zh: '端口 / 路径', vi: 'Cổng / Đường dẫn' },
  ],
  [
    [{ zh: '前端界面', vi: 'Giao diện frontend' }, { zh: 'React 19 + Vite + Tailwind CSS + Ant Design', vi: 'React 19 + Vite + Tailwind CSS + Ant Design' }, { zh: '静态文件，由后端托管（dist/client）', vi: 'Tệp tĩnh, do backend phục vụ (dist/client)' }],
    [{ zh: '后端接口', vi: 'API backend' }, { zh: 'NestJS 10 + Drizzle ORM', vi: 'NestJS 10 + Drizzle ORM' }, { zh: 'HTTP :3000，所有接口前缀 /api', vi: 'HTTP :3000, tất cả API tiền tố /api' }],
    [{ zh: '数据库', vi: 'Cơ sở dữ liệu' }, { zh: 'PostgreSQL 14+', vi: 'PostgreSQL 14+' }, { zh: ':5432，数据库名 wms', vi: ':5432, tên CSDL wms' }],
    [{ zh: '移动端 HTTPS', vi: 'HTTPS di động' }, { zh: '自签证书（PDA 扫码必需）', vi: 'Chứng chỉ tự ký (bắt buộc để PDA quét mã)' }, { zh: 'HTTPS :3443', vi: 'HTTPS :3443' }],
  ],
  { widths: [18, 42, 40] }
));

body.push(...callout('info',
  '系统同时监听 3000（HTTP）与 3443（HTTPS）两个端口，进程号相同。PC 端用 HTTP 即可；PDA 端调用摄像头扫码必须用 HTTPS。',
  'Hệ thống lắng nghe đồng thời hai cổng 3000 (HTTP) và 3443 (HTTPS) trong cùng một tiến trình. PC dùng HTTP là đủ; PDA muốn dùng camera quét mã bắt buộc phải dùng HTTPS.'
));

body.push(...biHeading(2, '1.2  服务器硬件与网络要求', '1.2  Yêu cầu phần cứng và mạng máy chủ'));

body.push(biTable(
  [
    { zh: '项目', vi: 'Hạng mục' },
    { zh: '最低要求', vi: 'Tối thiểu' },
    { zh: '推荐配置', vi: 'Khuyến nghị' },
  ],
  [
    [{ zh: 'CPU', vi: 'CPU' }, { zh: '2 核', vi: '2 nhân' }, { zh: '4 核及以上', vi: '4 nhân trở lên' }],
    [{ zh: '内存', vi: 'RAM' }, { zh: '4 GB', vi: '4 GB' }, { zh: '8 GB 及以上', vi: '8 GB trở lên' }],
    [{ zh: '磁盘', vi: 'Ổ cứng' }, { zh: '20 GB 可用空间', vi: '20 GB trống' }, { zh: 'SSD 50 GB 及以上', vi: 'SSD 50 GB trở lên' }],
    [{ zh: '操作系统', vi: 'Hệ điều hành' }, { zh: 'Windows Server 2019 / Ubuntu 20.04 / CentOS 8', vi: 'Windows Server 2019 / Ubuntu 20.04 / CentOS 8' }, { zh: 'Windows Server 2022 / Ubuntu 22.04 LTS', vi: 'Windows Server 2022 / Ubuntu 22.04 LTS' }],
    [{ zh: '网络', vi: 'Mạng' }, { zh: '局域网固定 IP', vi: 'IP tĩnh trong mạng LAN' }, { zh: '千兆内网，服务器 IP 固定不漂移', vi: 'LAN gigabit, IP máy chủ cố định' }],
  ],
  { widths: [16, 40, 44] }
));

body.push(...callout('warn',
  '服务器必须设置为固定 IP（静态 IP），不要用 DHCP 自动分配。否则服务器重启后 IP 变化，所有客户端和 PDA 都需要重新配置访问地址。',
  'Máy chủ phải được đặt IP tĩnh, không dùng DHCP tự động. Nếu không, sau khi khởi động lại IP sẽ thay đổi và mọi máy khách cùng PDA đều phải cấu hình lại địa chỉ.'
));

body.push(...biHeading(2, '1.3  软件依赖清单', '1.3  Danh sách phần mềm phụ thuộc'));

body.push(biTable(
  [
    { zh: '软件', vi: 'Phần mềm' },
    { zh: '版本要求', vi: 'Yêu cầu phiên bản' },
    { zh: '说明', vi: 'Mô tả' },
  ],
  [
    [{ zh: 'Node.js', vi: 'Node.js' }, { zh: '≥ 22.0.0（必须）', vi: '≥ 22.0.0 (bắt buộc)' }, { zh: '运行后端服务。工程 package.json 中已强制校验', vi: 'Chạy dịch vụ backend. Đã kiểm tra bắt buộc trong package.json' }],
    [{ zh: 'npm', vi: 'npm' }, { zh: '≥ 10.0.0', vi: '≥ 10.0.0' }, { zh: '随 Node.js 一起安装', vi: 'Cài kèm Node.js' }],
    [{ zh: 'PostgreSQL', vi: 'PostgreSQL' }, { zh: '≥ 14.0（推荐 16 或 18）', vi: '≥ 14.0 (khuyến nghị 16 hoặc 18)' }, { zh: '数据存储。需提前安装并创建数据库', vi: 'Lưu trữ dữ liệu. Cần cài trước và tạo CSDL' }],
    [{ zh: 'PM2（可选）', vi: 'PM2 (tùy chọn)' }, { zh: '最新版', vi: 'Bản mới nhất' }, { zh: 'Linux 下进程守护、开机自启，强烈推荐', vi: 'Giám sát tiến trình, tự khởi động trên Linux, rất khuyến nghị' }],
    [{ zh: 'Nginx（可选）', vi: 'Nginx (tùy chọn)' }, { zh: '最新稳定版', vi: 'Bản ổn định mới nhất' }, { zh: '如需用域名 / 80 端口访问，做反向代理', vi: 'Nếu muốn dùng tên miền / cổng 80 thì làm reverse proxy' }],
  ],
  { widths: [20, 26, 54] }
));

body.push(...biHeading(2, '1.4  部署方式选择', '1.4  Lựa chọn phương thức triển khai'));

body.push(...biPair(
  '根据服务器操作系统的不同，WMS 提供两种部署路径。请在开始前确认你的服务器系统类型。',
  'Tùy theo hệ điều hành máy chủ, WMS cung cấp hai hướng triển khai. Vui lòng xác nhận loại hệ điều hành trước khi bắt đầu.'
));

body.push(biTable(
  [
    { zh: '服务器系统', vi: 'Hệ điều hành' },
    { zh: '推荐路径', vi: 'Hướng dẫn khuyến nghị' },
    { zh: '对应章节', vi: 'Chương tương ứng' },
  ],
  [
    [{ zh: 'Windows Server / Windows 10/11', vi: 'Windows Server / Windows 10/11' }, { zh: '一键脚本 start.bat + 计划任务开机自启', vi: 'Script một nút start.bat + Task Scheduler tự khởi động' }, { zh: '第 3 章', vi: 'Chương 3' }],
    [{ zh: 'Ubuntu / CentOS / 麒麟等 Linux', vi: 'Ubuntu / CentOS / Kylin v.v.' }, { zh: '命令行部署 + PM2 守护进程', vi: 'Triển khai dòng lệnh + PM2 giám sát' }, { zh: '第 4 章', vi: 'Chương 4' }],
    [{ zh: '两种系统均适用', vi: 'Áp dụng cho cả hai' }, { zh: '数据库安装、参数配置、验收测试', vi: 'Cài CSDL, cấu hình tham số, kiểm thử nghiệm thu' }, { zh: '第 2 / 5 / 6 章', vi: 'Chương 2 / 5 / 6' }],
  ],
  { widths: [32, 46, 22] }
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 2 章  数据库准备', 'Chương 2  Chuẩn bị cơ sở dữ liệu'));

body.push(...biPair(
  'WMS 的所有业务数据（收料、检验、库存、工单等）都存储在 PostgreSQL 数据库中。本章介绍数据库的安装、建库和账号配置。',
  'Toàn bộ dữ liệu nghiệp vụ của WMS (nhận hàng, kiểm tra, tồn kho, lệnh sản xuất v.v.) đều lưu trong PostgreSQL. Chương này hướng dẫn cài đặt, tạo CSDL và cấu hình tài khoản.'
));

body.push(...biHeading(2, '2.1  安装 PostgreSQL', '2.1  Cài đặt PostgreSQL'));

body.push(...biPair('Windows 安装步骤：', 'Các bước cài trên Windows:'));
body.push(...step('访问 PostgreSQL 官网（https://www.postgresql.org/download/windows/）下载安装包，建议选择 16 或 18 版本。',
  'Truy cập trang chủ PostgreSQL (https://www.postgresql.org/download/windows/) tải bộ cài, khuyến nghị chọn bản 16 hoặc 18.'));
body.push(...step('双击安装包，一路「下一步」。组件勾选 PostgreSQL Server 与 Command Line Tools 即可。',
  'Nhấp đúp bộ cài, chọn "Next" liên tục. Chỉ cần tích PostgreSQL Server và Command Line Tools.'));
body.push(...step('设置超级用户 postgres 的密码 —— 请务必牢记，后续 .env 配置文件中要填写此密码。',
  'Đặt mật khẩu cho siêu người dùng postgres — phải ghi nhớ kỹ, vì sẽ điền vào tệp .env sau này.'));
body.push(...step('端口保持默认 5432。语言环境（Locale）默认即可，点击「下一步」完成安装。',
  'Giữ cổng mặc định 5432. Locale để mặc định, nhấn "Next" hoàn tất cài đặt.'));

body.push(...biPair('Linux 安装步骤（以 Ubuntu 为例）：', 'Các bước cài trên Linux (ví dụ Ubuntu):'));
body.push(...codeBlock([
  '# 1. 安装 PostgreSQL',
  'sudo apt-get update',
  'sudo apt-get install -y postgresql postgresql-contrib',
  '',
  '# 2. 启动服务并设置开机自启',
  'sudo systemctl start postgresql',
  'sudo systemctl enable postgresql',
  '',
  '# 3. 查看版本确认安装成功',
  'psql --version',
]));

body.push(...callout('warn',
  'Linux 环境下 PostgreSQL 默认只监听本地回环地址。如果数据库与应用部署在同一台服务器，无需修改；如果分服务器部署，需修改 postgresql.conf 中 listen_addresses = \'*\' 并配置 pg_hba.conf 允许远程连接。',
  'Trên Linux, PostgreSQL mặc định chỉ lắng nghe localhost. Nếu CSDL và ứng dụng cùng máy chủ thì không cần sửa; nếu khác máy chủ phải sửa listen_addresses = \'*\' trong postgresql.conf và cấu hình pg_hba.conf cho phép kết nối từ xa.'
));

body.push(...biHeading(2, '2.2  创建数据库', '2.2  Tạo cơ sở dữ liệu'));

body.push(...biPair(
  '数据库名称固定为 wms（需与 .env 中 DB_NAME 保持一致）。执行以下命令创建：',
  'Tên CSDL cố định là wms (phải khớp với DB_NAME trong .env). Thực hiện lệnh sau để tạo:'
));

body.push(...codeBlock([
  '# Windows：打开「SQL Shell (psql)」，或使用命令行',
  '# Linux：执行 sudo -u postgres psql',
  '',
  'CREATE DATABASE wms;',
  '\\q',
]));

body.push(...biPair('验证数据库是否创建成功：', 'Kiểm tra CSDL đã tạo thành công chưa:'));
body.push(...codeBlock([
  '# 列出所有数据库，应能看到 wms',
  'psql -U postgres -l',
]));

body.push(...callout('info',
  '本系统不使用独立的数据库用户，默认直接用 postgres 超级用户连接。生产环境如需更安全，可创建专用用户：CREATE USER wms WITH PASSWORD \'你的密码\'; 然后 GRANT ALL PRIVILEGES ON DATABASE wms TO wms;',
  'Hệ thống không dùng người dùng CSDL riêng, mặc định kết nối bằng siêu người dùng postgres. Nếu môi trường sản xuất cần an toàn hơn có thể tạo người dùng riêng: CREATE USER wms WITH PASSWORD \'mật khẩu\'; sau đó GRANT ALL PRIVILEGES ON DATABASE wms TO wms;'
));

body.push(...biHeading(2, '2.3  建表结构由程序自动完成', '2.3  Cấu trúc bảng do chương trình tự tạo'));

body.push(...biPair(
  '无需手工执行任何建表 SQL。项目提供的初始化脚本会自动完成：创建自定义类型、推送全部数据表、写入默认角色和管理员账号。相关命令在后续「配置与启动」章节统一执行。',
  'Không cần tự chạy bất kỳ câu SQL tạo bảng nào. Script khởi tạo của dự án sẽ tự động: tạo kiểu tùy chỉnh, đẩy toàn bộ bảng dữ liệu, ghi vai trò mặc định và tài khoản quản trị. Lệnh liên quan sẽ được thực hiện thống nhất ở chương "Cấu hình và khởi động" sau.'
));

body.push(...biPair(
  '初始化完成后，数据库中会建立约 107 张业务表，并自动创建 16 个默认角色（系统管理员、仓库主管、仓管员、IQC 检验员等）以及管理员账号 admin / admin。',
  'Sau khi khởi tạo xong, CSDL sẽ có khoảng 107 bảng nghiệp vụ, đồng thời tự tạo 16 vai trò mặc định (quản trị hệ thống, chủ quản kho, thủ kho, nhân viên IQC v.v.) và tài khoản quản trị admin / admin.'
));

body.push(...callout('warn',
  '首次登录后请立即修改管理员密码。默认密码 admin 仅为初始化用途，生产环境继续使用存在严重安全风险。',
  'Sau lần đăng nhập đầu tiên hãy đổi ngay mật khẩu quản trị. Mật khẩu mặc định admin chỉ dùng để khởi tạo, tiếp tục dùng trong sản xuất là rủi ro bảo mật nghiêm trọng.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 3 章  Windows 服务器部署', 'Chương 3  Triển khai trên máy chủ Windows'));

body.push(...biPair(
  '本章适用于 Windows Server 2019/2022 或 Windows 10/11 作为服务器。Windows 下部署最简单，双击脚本即可完成全部工作。',
  'Chương này áp dụng cho Windows Server 2019/2022 hoặc Windows 10/11 làm máy chủ. Triển khai trên Windows đơn giản nhất, chỉ cần nhấp đúp script là hoàn tất.'
));

body.push(...biHeading(2, '3.1  安装 Node.js 22', '3.1  Cài đặt Node.js 22'));

body.push(...step('访问 https://nodejs.org/ 下载 Node.js 22 LTS 的 Windows 安装包（.msi）。',
  'Truy cập https://nodejs.org/ tải bộ cài Windows (.msi) của Node.js 22 LTS.'));
body.push(...step('双击安装，全部保持默认选项，勾选「Add to PATH」。',
  'Nhấp đúp cài đặt, giữ mặc định toàn bộ, tích "Add to PATH".'));
body.push(...step('安装完成后打开「命令提示符（CMD）」，输入以下命令验证：',
  'Sau khi cài xong mở Command Prompt (CMD), nhập lệnh sau để kiểm tra:'));
body.push(...codeBlock(['node -v', 'npm -v']));
body.push(...biPair('正确输出应为 v22.x.x 与 10.x.x 或更高。若提示「不是内部或外部命令」，请重启命令行窗口或检查环境变量 PATH。',
  'Kết quả đúng phải là v22.x.x và 10.x.x trở lên. Nếu báo "không phải lệnh nội bộ", hãy khởi động lại cửa sổ dòng lệnh hoặc kiểm tra biến môi trường PATH.'));

body.push(...biHeading(2, '3.2  部署应用程序文件', '3.2  Triển khai tệp ứng dụng'));

body.push(...step('在服务器上创建部署目录，例如 D:\\WMS，将完整的工程文件夹复制进去。',
  'Tạo thư mục triển khai trên máy chủ, ví dụ D:\\WMS, sao chép toàn bộ thư mục dự án vào.'));
body.push(...step('确认工程根目录下能看到以下关键文件：package.json、start.bat、.env.example、server 目录、client 目录。',
  'Xác nhận thư mục gốc dự án có các tệp quan trọng: package.json, start.bat, .env.example, thư mục server, thư mục client.'));

body.push(...callout('warn',
  '不要复制 node_modules 和 dist 目录（体积大且可能包含旧机器路径）。系统会在首次启动时自动重新安装依赖并构建。',
  'Không sao chép thư mục node_modules và dist (dung lượng lớn và có thể chứa đường dẫn máy cũ). Hệ thống sẽ tự cài lại phụ thuộc và build ở lần khởi động đầu tiên.'
));

body.push(...biHeading(2, '3.3  配置 .env 文件', '3.3  Cấu hình tệp .env'));

body.push(...biPair(
  '双击 start.bat 后脚本会先检查 .env。若 .env 不存在，或其中的 DB_PASSWORD 仍是模板里的占位文字，脚本会进入「数据库配置向导」，逐项询问数据库地址、端口、用户名、密码、库名与服务端口，并自动生成一份 48 字节的随机 JWT 密钥一并写入 .env。因此首次部署时按屏幕提示输入即可，既不需要手工创建配置文件，也不需要手工生成密钥。',
  'Sau khi nhấp đúp start.bat, script kiểm tra .env trước. Nếu .env chưa có, hoặc DB_PASSWORD vẫn là chữ giữ chỗ trong mẫu, script sẽ vào "Trình hướng dẫn cấu hình CSDL", hỏi lần lượt địa chỉ, cổng, tên người dùng, mật khẩu, tên CSDL và cổng dịch vụ, đồng thời tự sinh một khóa JWT ngẫu nhiên 48 byte ghi vào .env. Vì vậy lần triển khai đầu chỉ cần nhập theo nhắc trên màn hình, không cần tự tạo tệp cấu hình và không cần tự sinh khóa.'
));

body.push(...biPair(
  '若 .env 已存在且密码已填写，向导会被自动跳过。此时如需调整参数（例如把 HTTP 端口从 3000 改到 8080），可用记事本手工编辑 .env，各参数含义见下表。',
  'Nếu .env đã tồn tại và mật khẩu đã điền, trình hướng dẫn sẽ tự động bị bỏ qua. Khi đó muốn đổi tham số (ví dụ đổi cổng HTTP từ 3000 sang 8080) có thể dùng Notepad sửa .env thủ công; ý nghĩa các tham số xem bảng dưới đây.'
));

body.push(biTable(
  [
    { zh: '参数名', vi: 'Tên tham số' },
    { zh: '建议值', vi: 'Giá trị đề xuất' },
    { zh: '说明', vi: 'Mô tả' },
  ],
  [
    [{ zh: 'NODE_ENV', vi: 'NODE_ENV', mono: true }, { zh: 'production', vi: 'production', mono: true }, { zh: '生产环境，关闭调试特性，出错不会静默', vi: 'Môi trường sản xuất, tắt tính năng gỡ lỗi, lỗi không bị bỏ qua' }],
    [{ zh: 'SERVER_HOST', vi: 'SERVER_HOST', mono: true }, { zh: '0.0.0.0', vi: '0.0.0.0', mono: true }, { zh: '监听所有网卡，局域网内其他电脑才能访问', vi: 'Lắng nghe mọi card mạng, máy khác trong LAN mới truy cập được' }],
    [{ zh: 'SERVER_PORT', vi: 'SERVER_PORT', mono: true }, { zh: '3000', vi: '3000', mono: true }, { zh: 'HTTP 端口，如被占用可改为 8080 等', vi: 'Cổng HTTP, nếu bị chiếm có thể đổi thành 8080...' }],
    [{ zh: 'DB_HOST', vi: 'DB_HOST', mono: true }, { zh: 'localhost', vi: 'localhost', mono: true }, { zh: '数据库地址，同机部署填 localhost', vi: 'Địa chỉ CSDL, cùng máy chủ thì điền localhost' }],
    [{ zh: 'DB_PORT', vi: 'DB_PORT', mono: true }, { zh: '5432', vi: '5432', mono: true }, { zh: 'PostgreSQL 默认端口', vi: 'Cổng mặc định PostgreSQL' }],
    [{ zh: 'DB_USER', vi: 'DB_USER', mono: true }, { zh: 'postgres', vi: 'postgres', mono: true }, { zh: '数据库用户名', vi: 'Tên người dùng CSDL' }],
    [{ zh: 'DB_PASSWORD', vi: 'DB_PASSWORD', mono: true }, { zh: '（安装时设置的密码）', vi: '(mật khẩu đã đặt khi cài)', bold: true }, { zh: '【必填】PostgreSQL 实际密码。运行向导时必须输入；手工编辑 .env 时也必须填写', vi: '【BẮT BUỘC ĐIỀN】mật khẩu PostgreSQL thực tế. Phải nhập khi chạy trình hướng dẫn; cũng phải điền khi sửa .env thủ công' }],
    [{ zh: 'DB_NAME', vi: 'DB_NAME', mono: true }, { zh: 'wms', vi: 'wms', mono: true }, { zh: '数据库名，需与 2.2 节创建的一致', vi: 'Tên CSDL, phải khớp với mục 2.2' }],
    [{ zh: 'JWT_SECRET', vi: 'JWT_SECRET', mono: true }, { zh: '（向导自动生成的随机值）', vi: '(giá trị ngẫu nhiên do trình hướng dẫn tự sinh)' }, { zh: '登录令牌密钥，泄露可伪造身份。向导已自动生成随机值；仅在手工创建 .env 时才需自行填入', vi: 'Khóa token đăng nhập, lộ có thể giả mạo danh tính. Trình hướng dẫn đã tự sinh giá trị ngẫu nhiên; chỉ khi tự tạo .env thủ công mới cần tự điền' }],
    [{ zh: 'VITE_API_BASE_URL', vi: 'VITE_API_BASE_URL', mono: true }, { zh: '/', vi: '/', mono: true }, { zh: '同域部署保持 / 即可', vi: 'Triển khai cùng tên miền giữ / là được' }],
    [{ zh: 'LOG_DIR', vi: 'LOG_DIR', mono: true }, { zh: './logs', vi: './logs', mono: true }, { zh: '日志目录，自动创建', vi: 'Thư mục log, tự tạo' }],
  ],
  { widths: [24, 26, 50] }
));

body.push(...biPair('若手工创建 .env（未使用向导），可按以下方式自行生成随机 JWT_SECRET（Windows CMD）：', 'Nếu tự tạo .env thủ công (không dùng trình hướng dẫn), có thể tự sinh JWT_SECRET ngẫu nhiên như sau (CMD Windows):'));
body.push(...codeBlock(['node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"']));
body.push(...biPair('Linux 下可用：', 'Trên Linux có thể dùng:'));
body.push(...codeBlock(['openssl rand -hex 48']));

body.push(...callout('warn',
  '.env 是系统最重要的配置文件，包含数据库密码和密钥。不要提交到代码仓库、不要通过微信/邮件随意传输，建议单独备份保管。',
  '.env là tệp cấu hình quan trọng nhất, chứa mật khẩu CSDL và khóa bí mật. Không đưa lên kho mã, không gửi qua WeChat/email tùy tiện, nên sao lưu và bảo quản riêng.'
));

body.push(...biHeading(2, '3.4  一键启动', '3.4  Khởi động một nút'));

body.push(...biPair(
  '双击工程根目录下的 start.bat。脚本会按顺序执行下列六个步骤；除首次运行需要按屏幕提示输入一次数据库密码外，其余无需人工干预：',
  'Nhấp đúp start.bat trong thư mục gốc dự án. Script chạy tuần tự sáu bước dưới đây; ngoài việc lần chạy đầu cần nhập một lần mật khẩu CSDL theo nhắc trên màn hình, các bước còn lại không cần can thiệp thủ công:'
));

body.push(biTable(
  [
    { zh: '步骤', vi: 'Bước' },
    { zh: '脚本动作', vi: 'Hành động của script' },
    { zh: '耗时参考', vi: 'Thời gian tham khảo' },
  ],
  [
    [{ zh: '1/6', vi: '1/6' }, { zh: '检测 Node.js：未安装或版本低于 22 时直接报错退出', vi: 'Kiểm tra Node.js: chưa cài hoặc thấp hơn 22 thì báo lỗi và thoát' }, { zh: '几秒', vi: 'Vài giây' }],
    [{ zh: '2/6', vi: '2/6' }, { zh: '安装依赖：node_modules 不存在时执行 npm install，已存在则跳过', vi: 'Cài phụ thuộc: nếu chưa có node_modules thì chạy npm install, đã có thì bỏ qua' }, { zh: '3–10 分钟（仅首次）', vi: '3–10 phút (chỉ lần đầu)' }],
    [{ zh: '3/6', vi: '3/6' }, { zh: '检查配置：.env 缺失或仍是占位密码时进入配置向导，生成 .env 与随机 JWT 密钥', vi: 'Kiểm tra cấu hình: nếu .env chưa có hoặc còn mật khẩu giữ chỗ thì vào trình hướng dẫn, sinh .env và khóa JWT ngẫu nhiên' }, { zh: '十几秒（仅首次）', vi: 'Vài chục giây (chỉ lần đầu)' }],
    [{ zh: '4/6', vi: '4/6' }, { zh: '构建前后端：dist/main.js 或 dist/client/index.html 缺失时执行 nest build 与 vite build', vi: 'Build frontend/backend: nếu thiếu dist/main.js hoặc dist/client/index.html thì chạy nest build và vite build' }, { zh: '1–3 分钟（仅首次）', vi: '1–3 phút (chỉ lần đầu)' }],
    [{ zh: '5/6', vi: '5/6' }, { zh: '检查数据库连接并初始化：连不上会列出排查清单；首次运行自动建表 / 建默认角色 / 建管理员账号，之后跳过', vi: 'Kiểm tra kết nối CSDL và khởi tạo: nếu không kết nối được sẽ liệt kê cách kiểm tra; lần đầu tự tạo bảng / vai trò mặc định / tài khoản quản trị, các lần sau bỏ qua' }, { zh: '10–30 秒（仅首次）', vi: '10–30 giây (chỉ lần đầu)' }],
    [{ zh: '6/6', vi: '6/6' }, { zh: '启动服务：node dist/main.js，同一进程同时监听 3000（HTTP）与 3443（HTTPS）', vi: 'Khởi động dịch vụ: node dist/main.js, cùng một tiến trình lắng nghe 3000 (HTTP) và 3443 (HTTPS)' }, { zh: '数秒', vi: 'Vài giây' }],
  ],
  { widths: [12, 68, 20] }
));

body.push(...biPair('看到如下输出即表示启动成功：', 'Thấy kết quả như dưới là khởi động thành công:'));
body.push(...codeBlock([
  '========================================',
  '  WMS 系统已启动',
  '',
  '  PC 端:   http://localhost:3000',
  '  PDA 端:  http://localhost:3000/pda/login',
  '  账号:    admin / admin',
  '========================================',
  '',
  '  [提示] 本窗口不能关闭，关闭即停止服务。',
  '  [提示] 局域网访问请用本机 IP 代替 localhost。',
  '  [提示] 首次登录后请立即修改管理员密码。',
  '========================================',
  '',
  '[Nest] WMS Server running on http://0.0.0.0:3000',
  '[Nest] WMS HTTPS Server running on https://0.0.0.0:3443',
], { bar: '538135', fill: 'E2EFDA' }));

body.push(...callout('info',
  '启动窗口不能关闭 —— 关闭窗口等于停止服务。关闭后重新部署只需再次双击 start.bat（依赖与构建已完成，会很快进入启动状态）。',
  'Không được đóng cửa sổ khởi động — đóng cửa sổ nghĩa là dừng dịch vụ. Khi cần chạy lại chỉ cần nhấp đúp start.bat lần nữa (phụ thuộc và build đã xong nên vào trạng thái chạy rất nhanh).'
));

body.push(...biHeading(2, '3.5  配置防火墙放行', '3.5  Cấu hình mở tường lửa'));

body.push(...biPair(
  'Windows 默认会拦截外部访问。需要放行 3000 与 3443 端口，局域网内其他设备才能访问。以管理员身份打开 PowerShell 执行：',
  'Windows mặc định chặn truy cập từ bên ngoài. Cần mở cổng 3000 và 3443 để thiết bị khác trong LAN truy cập được. Mở PowerShell bằng quyền quản trị và chạy:'
));

body.push(...codeBlock([
  'netsh advfirewall firewall add rule name="WMS-HTTP-3000" dir=in action=allow protocol=TCP localport=3000',
  'netsh advfirewall firewall add rule name="WMS-HTTPS-3443" dir=in action=allow protocol=TCP localport=3443',
]));

body.push(...biPair('删除规则（如需）：', 'Xóa quy tắc (nếu cần):'));
body.push(...codeBlock([
  'netsh advfirewall firewall delete rule name="WMS-HTTP-3000"',
  'netsh advfirewall firewall delete rule name="WMS-HTTPS-3443"',
]));

body.push(...callout('warn',
  '如果服务器上还装了第三方安全软件（360、火绒、企业 EDR 等），也需在其中放行 3000/3443 端口，否则即使系统防火墙放行仍可能被拦截。',
  'Nếu máy chủ còn cài phần mềm bảo mật bên thứ ba (360, Huorong, EDR doanh nghiệp...), cũng cần mở cổng 3000/3443 trong đó, nếu không dù tường lửa hệ thống đã mở vẫn có thể bị chặn.'
));

body.push(...biHeading(2, '3.6  设置开机自启（推荐）', '3.6  Cấu hình tự khởi động (khuyến nghị)'));

body.push(...biPair(
  '服务器重启后需要人工双击 start.bat 才能恢复服务，这不适合生产环境。推荐用 Windows 计划任务实现开机自动启动。',
  'Sau khi máy chủ khởi động lại phải nhấp đúp start.bat thủ công mới khôi phục dịch vụ, không phù hợp môi trường sản xuất. Khuyến nghị dùng Task Scheduler của Windows để tự khởi động.'
));

body.push(...step('以管理员身份运行「任务计划程序」（taskschd.msc）。',
  'Chạy "Task Scheduler" (taskschd.msc) bằng quyền quản trị.'));
body.push(...step('右侧点击「创建任务」（不是「创建基本任务」）。',
  'Nhấp "Create Task" bên phải (không phải "Create Basic Task").'));
body.push(...step('【常规】页：名称填 WMS-Server；勾选「不管用户是否登录都要运行」；勾选「使用最高权限运行」。',
  'Tab "General": đặt tên WMS-Server; tích "Run whether user is logged on or not"; tích "Run with highest privileges".'));
body.push(...step('【触发器】页：新建触发器 → 开始任务选「启动时」→ 确定。',
  'Tab "Triggers": New → Begin the task chọn "At startup" → OK.'));
body.push(...step('【操作】页：新建操作 → 程序或脚本填 start.bat 的完整路径（如 D:\\WMS\\start.bat）→ 起始于填 D:\\WMS → 确定。',
  'Tab "Actions": New → Program/script điền đường dẫn đầy đủ của start.bat (ví dụ D:\\WMS\\start.bat) → Start in điền D:\\WMS → OK.'));
body.push(...step('【设置】页：勾选「如果任务失败，按以下频率重新启动」，间隔 1 分钟，尝试 3 次。',
  'Tab "Settings": tích "If the task fails, restart every", khoảng 1 phút, thử 3 lần.'));
body.push(...step('保存时输入服务器管理员账号密码，完成后右键任务 →「运行」测试一次。',
  'Khi lưu nhập tài khoản/mật khẩu quản trị máy chủ, sau đó chuột phải task → "Run" để thử một lần.'));

body.push(...callout('info',
  '计划任务中 start.bat 会随服务持续运行（服务不退出，任务就不结束，这是正常现象）。但脚本末尾有一条 pause：一旦服务意外退出，脚本会停在「按任意键继续」而不结束任务，计划任务的「失败自动重启」就会失效。若使用计划任务，建议先删除 start.bat 最后一行的 pause；更稳妥的做法是改用第 4 章的 PM2 或 systemd 方案。',
  'Trong Task Scheduler, start.bat sẽ chạy liên tục cùng dịch vụ (dịch vụ không thoát thì task không kết thúc, đây là hiện tượng bình thường). Nhưng cuối script có một câu pause: nếu dịch vụ thoát bất ngờ, script sẽ dừng ở "nhấn phím bất kỳ" mà không kết thúc task, khiến chính sách "tự khởi động lại khi lỗi" của Task Scheduler mất tác dụng. Nếu dùng Task Scheduler, nên xóa dòng pause cuối start.bat; cách an toàn hơn là dùng PM2 hoặc systemd ở Chương 4.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 4 章  Linux 服务器部署', 'Chương 4  Triển khai trên máy chủ Linux'));

body.push(...biPair(
  '本章适用于 Ubuntu、CentOS、麒麟等 Linux 服务器。Linux 下推荐使用 PM2 做进程守护，可实现崩溃自动重启、开机自启、日志集中管理。',
  'Chương này áp dụng cho máy chủ Linux như Ubuntu, CentOS, Kylin. Trên Linux khuyến nghị dùng PM2 để giám sát tiến trình, tự khởi động lại khi lỗi, tự chạy khi khởi động máy, quản lý log tập trung.'
));

body.push(...biHeading(2, '4.1  安装 Node.js 22', '4.1  Cài đặt Node.js 22'));

body.push(...biPair('Ubuntu / Debian：', 'Ubuntu / Debian:'));
body.push(...codeBlock([
  'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
  'sudo apt-get install -y nodejs',
  'node -v && npm -v',
]));
body.push(...biPair('CentOS / RHEL / 麒麟：', 'CentOS / RHEL / Kylin:'));
body.push(...codeBlock([
  'curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -',
  'sudo yum install -y nodejs',
  'node -v && npm -v',
]));

body.push(...biHeading(2, '4.2  上传代码并安装依赖', '4.2  Tải mã nguồn lên và cài phụ thuộc'));

body.push(...codeBlock([
  '# 1. 创建部署目录',
  'sudo mkdir -p /opt/wms && sudo chown -R $USER:$USER /opt/wms',
  '',
  '# 2. 用 SFTP / scp / Git 把工程文件上传到 /opt/wms',
  '#    推荐用 scp 从本地推送（在本地电脑执行）：',
  '#    scp -r ./WMS-standalone/* user@服务器IP:/opt/wms/',
  '',
  '# 3. 进入目录安装依赖',
  'cd /opt/wms',
  'npm install',
]));

body.push(...callout('warn',
  'npm install 依赖国外镜像源，网络慢时可切换国内源加速：npm config set registry https://registry.npmmirror.com',
  'npm install phụ thuộc máy chủ nước ngoài, mạng chậm có thể chuyển sang mirror trong nước: npm config set registry https://registry.npmmirror.com'
));

body.push(...biHeading(2, '4.3  配置 .env', '4.3  Cấu hình .env'));

body.push(...codeBlock([
  'cd /opt/wms',
  'cp .env.example .env',
  'vi .env',
  '',
  '# 需修改的关键参数（其余保持默认）：',
  '# NODE_ENV=production',
  '# SERVER_HOST=0.0.0.0',
  '# DB_PASSWORD=你的PostgreSQL密码',
  '# JWT_SECRET=运行 openssl rand -hex 48 生成的随机串',
]));

body.push(...biPair('生成 JWT_SECRET：', 'Tạo JWT_SECRET:'));
body.push(...codeBlock(['openssl rand -hex 48']));

body.push(...biHeading(2, '4.4  初始化数据库并构建', '4.4  Khởi tạo CSDL và build'));

body.push(...codeBlock([
  'cd /opt/wms',
  '',
  '# 初始化数据库（建表 + 默认角色 + 管理员账号）',
  'npx ts-node server/scripts/init-db.ts',
  '',
  '# 构建前端 + 后端',
  'npm run build',
]));

body.push(...callout('info',
  '构建成功的标志：工程根目录生成 dist 文件夹，其中含 dist/main.js（后端入口）与 dist/client/index.html（前端入口）。',
  'Dấu hiệu build thành công: thư mục gốc dự án sinh ra thư mục dist, trong đó có dist/main.js (điểm vào backend) và dist/client/index.html (điểm vào frontend).'
));

body.push(...biHeading(2, '4.5  使用 PM2 启动并守护', '4.5  Dùng PM2 khởi động và giám sát'));

body.push(...codeBlock([
  '# 1. 全局安装 PM2',
  'sudo npm install -g pm2',
  '',
  '# 2. 启动服务（在 /opt/wms 目录下执行）',
  'cd /opt/wms',
  'pm2 start dist/main.js --name wms',
  '',
  '# 3. 保存当前进程列表',
  'pm2 save',
  '',
  '# 4. 配置开机自启（按提示执行输出的那条命令）',
  'pm2 startup',
]));

body.push(...biPair('PM2 常用管理命令：', 'Các lệnh quản lý PM2 thường dùng:'));
body.push(biTable(
  [
    { zh: '命令', vi: 'Lệnh' },
    { zh: '作用', vi: 'Tác dụng' },
  ],
  [
    [{ zh: 'pm2 list', vi: 'pm2 list', mono: true }, { zh: '查看所有进程状态', vi: 'Xem trạng thái mọi tiến trình' }],
    [{ zh: 'pm2 logs wms', vi: 'pm2 logs wms', mono: true }, { zh: '实时查看运行日志', vi: 'Xem log chạy theo thời gian thực' }],
    [{ zh: 'pm2 restart wms', vi: 'pm2 restart wms', mono: true }, { zh: '重启服务（更新代码后使用）', vi: 'Khởi động lại dịch vụ (dùng sau khi cập nhật mã)' }],
    [{ zh: 'pm2 stop wms', vi: 'pm2 stop wms', mono: true }, { zh: '停止服务', vi: 'Dừng dịch vụ' }],
    [{ zh: 'pm2 delete wms', vi: 'pm2 delete wms', mono: true }, { zh: '删除进程（重新部署时使用）', vi: 'Xóa tiến trình (dùng khi triển khai lại)' }],
    [{ zh: 'pm2 monit', vi: 'pm2 monit', mono: true }, { zh: '实时监控 CPU / 内存', vi: 'Giám sát CPU / RAM thời gian thực' }],
  ],
  { widths: [34, 66] }
));

body.push(...callout('warn',
  '注意：必须使用 dist/main.js，而不是 dist/server/main.js —— 构建产物位于 dist/main.js。工程根目录下的 start.sh 已完成同步修正，可直接以 bash start.sh 方式启动，与本章的 PM2 命令等效。',
  'Lưu ý: phải dùng dist/main.js, không phải dist/server/main.js — sản phẩm build nằm ở dist/main.js. Tệp start.sh ở thư mục gốc đã được sửa đồng bộ, có thể khởi động trực tiếp bằng bash start.sh, tương đương với lệnh PM2 trong chương này.'
));

body.push(...biHeading(2, '4.6  配置防火墙放行', '4.6  Cấu hình mở tường lửa'));

body.push(...codeBlock([
  '# Ubuntu（ufw）',
  'sudo ufw allow 3000/tcp',
  'sudo ufw allow 3443/tcp',
  'sudo ufw reload',
  '',
  '# CentOS（firewalld）',
  'sudo firewall-cmd --permanent --add-port=3000/tcp',
  'sudo firewall-cmd --permanent --add-port=3443/tcp',
  'sudo firewall-cmd --reload',
]));

body.push(...biHeading(2, '4.7  系统层服务方式（可选方案）', '4.7  Dùng systemd (phương án tùy chọn)'));

body.push(...biPair(
  '如果不想引入 PM2，也可以用 systemd 托管。创建服务文件 /etc/systemd/system/wms.service：',
  'Nếu không muốn dùng PM2, có thể dùng systemd. Tạo tệp dịch vụ /etc/systemd/system/wms.service:'
));

body.push(...codeBlock([
  '[Unit]',
  'Description=WMS Warehouse Management System',
  'After=network.target postgresql.service',
  '',
  '[Service]',
  'Type=simple',
  'User=wms',
  'WorkingDirectory=/opt/wms',
  'ExecStart=/usr/bin/node /opt/wms/dist/main.js',
  'Restart=always',
  'RestartSec=10',
  'Environment=NODE_ENV=production',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
]));

body.push(...codeBlock([
  'sudo systemctl daemon-reload',
  'sudo systemctl enable wms',
  'sudo systemctl start wms',
  'sudo systemctl status wms',
]));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 5 章  PDA 移动端与 HTTPS 配置', 'Chương 5  Cấu hình PDA và HTTPS'));

body.push(...biPair(
  'PDA 手持终端用于扫码收货、上架、拣货、发料等现场作业。本章说明 PDA 的连接方式和 HTTPS 证书安装。',
  'Thiết bị cầm tay PDA dùng để quét mã nhận hàng, lên kệ, nhặt hàng, xuất kho tại hiện trường. Chương này hướng dẫn cách kết nối và cài chứng chỉ HTTPS cho PDA.'
));

body.push(...biHeading(2, '5.1  为什么 PDA 需要 HTTPS', '5.1  Vì sao PDA cần HTTPS'));

body.push(...biPair(
  '现代浏览器规定：只有在安全上下文（HTTPS）下才允许网页调用摄像头。PDA 如果直接扫码枪输入则用 HTTP 即可；如果要用 PDA 自带摄像头拍照/扫码，则必须通过 HTTPS 访问。',
  'Trình duyệt hiện đại quy định: chỉ trong ngữ cảnh an toàn (HTTPS) mới cho phép trang web gọi camera. Nếu PDA dùng súng quét mã cắm ngoài thì HTTP là đủ; nếu muốn dùng camera sẵn có của PDA để chụp/quét thì bắt buộc truy cập qua HTTPS.'
));

body.push(biTable(
  [
    { zh: 'PDA 类型', vi: 'Loại PDA' },
    { zh: '访问地址', vi: 'Địa chỉ truy cập' },
    { zh: '是否需要装证书', vi: 'Cần cài chứng chỉ?' },
  ],
  [
    [{ zh: '带扫描头的工业 PDA', vi: 'PDA công nghiệp có đầu quét' }, { zh: 'http://服务器IP:3000/pda/login', vi: 'http://IP_máy_chủ:3000/pda/login', mono: true }, { zh: '不需要', vi: 'Không cần' }],
    [{ zh: '普通安卓手机 / 平板', vi: 'Điện thoại / máy tính bảng Android thường' }, { zh: 'https://服务器IP:3443/pda/login', vi: 'https://IP_máy_chủ:3443/pda/login', mono: true }, { zh: '需要（首次）', vi: 'Cần (lần đầu)' }],
    [{ zh: '苹果 iPhone / iPad', vi: 'iPhone / iPad của Apple' }, { zh: 'https://服务器IP:3443/pda/login', vi: 'https://IP_máy_chủ:3443/pda/login', mono: true }, { zh: '需要（首次，且须开启完全信任）', vi: 'Cần (lần đầu, phải bật tin cậy hoàn toàn)' }],
  ],
  { widths: [26, 40, 34] }
));

body.push(...biHeading(2, '5.2  安装 HTTPS 证书', '5.2  Cài chứng chỉ HTTPS'));

body.push(...biPair(
  '系统内置自签名证书，并在局域网 IP 变化时自动重新签发。安卓手机与苹果手机（iPhone / iPad）的安装路径不同，请先按机型选择对应步骤。',
  'Hệ thống tích hợp chứng chỉ tự ký và tự gia hạn khi IP mạng LAN thay đổi. Android và iPhone / iPad có cách cài khác nhau, hãy chọn đúng theo loại máy.'
));

// ---------- 5.2.1 安卓 ----------
body.push(...biHeading(3, '安卓手机 / 平板', 'Điện thoại / máy tính bảng Android'));

body.push(...biPair(
  '用手机浏览器打开证书安装页：http://服务器IP:3000/cert （HTTP 访问，无需证书）。',
  'Mở trang cài chứng chỉ bằng trình duyệt điện thoại: http://IP_máy_chủ:3000/cert (truy cập HTTP, không cần chứng chỉ).'
));
body.push(...step('页面会显示当前服务器 IP 与证书信息，点击「下载证书」，保存 wms-https-cert.crt 文件。',
  'Trang hiển thị IP máy chủ hiện tại và thông tin chứng chỉ, nhấp "Tải chứng chỉ", lưu tệp wms-https-cert.crt.'));
body.push(...step('进入「设置 → 安全 → 凭据存储 / 安装证书 → CA 证书」，选择刚下载的 crt 文件安装。',
  'Vào "Cài đặt → Bảo mật → Lưu trữ thông tin xác thực / Cài chứng chỉ → Chứng chỉ CA", chọn tệp crt vừa tải để cài.'));
body.push(...step('安装时系统会要求设置锁屏密码，按提示设置；证书用途选「VPN 和应用」。',
  'Khi cài hệ thống yêu cầu đặt mật khẩu khóa màn hình, làm theo hướng dẫn; mục đích chứng chỉ chọn "VPN và ứng dụng".'));
body.push(...step('完成后用 https://服务器IP:3443/pda/login 访问，浏览器不再报警告即表示成功。',
  'Sau khi xong truy cập https://IP_máy_chủ:3443/pda/login, trình duyệt không còn cảnh báo là thành công.'));

// ---------- 5.2.2 苹果 ----------
body.push(...biHeading(3, '苹果 iPhone / iPad', 'iPhone / iPad của Apple'));

body.push(...biPair(
  '必须用 Safari 打开证书安装页：http://服务器IP:3000/cert 。微信、QQ 等内置浏览器无法安装描述文件，请务必使用系统自带的 Safari。',
  'Bắt buộc mở trang cài chứng chỉ bằng Safari: http://IP_máy_chủ:3000/cert . Trình duyệt trong WeChat, QQ không cài được cấu hình, hãy dùng Safari mặc định của hệ thống.'
));
body.push(...step('点击页面上的「下载并安装证书」，Safari 会提示「此网站正尝试下载一个配置描述文件」，点「允许」；随后提示「已下载描述文件」，点「关闭」。',
  'Nhấn "Tải và cài chứng chỉ" trên trang, Safari báo "Trang web này đang cố tải một cấu hình", chọn "Cho phép"; sau đó báo "Đã tải cấu hình", chọn "Đóng".'));
body.push(...step('打开「设置」，首页顶部会出现「已下载描述文件」，点进去。（若没有，走：设置 → 通用 → VPN 与设备管理）',
  'Mở "Cài đặt", ở đầu trang sẽ thấy "Đã tải cấu hình", nhấn vào. (Nếu không có: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị)'));
body.push(...step('点右上角「安装」，输入锁屏密码，再点一次「安装」，最后点「完成」。',
  'Nhấn "Cài đặt" ở góc phải trên, nhập mật khẩu khóa màn hình, nhấn "Cài đặt" một lần nữa, cuối cùng nhấn "Xong".'));
body.push(...step('打开「设置 → 通用 → 关于本机」，滑到最底部点「证书信任设置」，找到「WMS HTTPS Cert」，打开右侧开关，弹窗点「继续」。',
  'Mở "Cài đặt → Cài đặt chung → Giới thiệu", kéo xuống cuối và nhấn "Cài đặt tin cậy chứng chỉ", tìm "WMS HTTPS Cert", bật công tắc bên phải, chọn "Tiếp tục".'));
body.push(...step('用 Safari 打开 https://服务器IP:3443/pda/login ，不再提示证书不受信任即表示成功。',
  'Dùng Safari mở https://IP_máy_chủ:3443/pda/login , nếu không còn cảnh báo chứng chỉ không đáng tin là thành công.'));

body.push(...callout('warn',
  '苹果手机最常见的失败原因：只安装了描述文件，没有在「证书信任设置」里开启完全信任。此时 Safari 依旧提示证书不受信任，网页也无法调用摄像头扫码。第 4 步是必须做的。',
  'Nguyên nhân thất bại phổ biến nhất trên iPhone: đã cài cấu hình nhưng chưa bật tin cậy hoàn toàn trong "Cài đặt tin cậy chứng chỉ". Khi đó Safari vẫn báo chứng chỉ không đáng tin và trang web không gọi được camera để quét mã. Bước 4 là bắt buộc.'
));

body.push(...callout('warn',
  '如果服务器局域网 IP 发生变化（更换网络、更换路由器），系统会自动重新生成证书。此时所有 PDA 需要重新执行本章安装步骤，否则 HTTPS 将无法访问。',
  'Nếu IP mạng LAN của máy chủ thay đổi (đổi mạng, đổi router), hệ thống sẽ tự tạo lại chứng chỉ. Lúc đó mọi PDA phải thực hiện lại các bước cài trong chương này, nếu không HTTPS sẽ không truy cập được.'
));

body.push(...biHeading(2, '5.3  PDA 端访问与使用', '5.3  Truy cập và sử dụng PDA'));

body.push(biTable(
  [
    { zh: '项目', vi: 'Hạng mục' },
    { zh: '要求 / 地址', vi: 'Yêu cầu / Địa chỉ' },
  ],
  [
    [{ zh: '操作系统', vi: 'Hệ điều hành' }, { zh: 'Android 8.0 及以上 / iOS 12 及以上', vi: 'Android 8.0 trở lên / iOS 12 trở lên' }],
    [{ zh: '浏览器', vi: 'Trình duyệt' }, { zh: 'Chrome 或系统自带浏览器；苹果设备必须用 Safari', vi: 'Chrome hoặc trình duyệt hệ thống; thiết bị Apple bắt buộc dùng Safari' }],
    [{ zh: 'PDA 登录页', vi: 'Trang đăng nhập PDA' }, { zh: 'http(s)://服务器IP:端口/pda/login', vi: 'http(s)://IP_máy_chủ:cổng/pda/login', mono: true }],
    [{ zh: 'PDA 首页', vi: 'Trang chủ PDA' }, { zh: '/pda/home', vi: '/pda/home', mono: true }],
    [{ zh: '默认账号', vi: 'Tài khoản mặc định' }, { zh: 'admin / admin', vi: 'admin / admin', mono: true }],
    [{ zh: '扫码枪', vi: 'Súng quét mã' }, { zh: '支持键盘模式输出（即插即用），扫描后自动回车触发', vi: 'Hỗ trợ chế độ bàn phím (cắm là dùng), quét xong tự Enter kích hoạt' }],
  ],
  { widths: [26, 74] }
));

body.push(...callout('info',
  '建议在 PDA 的 Chrome 菜单中选「添加到主屏幕」，之后可像 App 一样全屏打开，无需每次输入网址。',
  'Khuyến nghị trong menu Chrome của PDA chọn "Thêm vào màn hình chính", sau đó có thể mở toàn màn hình như App, không cần nhập địa chỉ mỗi lần.'
));

body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));

// ============================================================
body.push(...biHeading(1, '第 6 章  部署验收与日常运维', 'Chương 6  Nghiệm thu triển khai và vận hành'));

body.push(...biHeading(2, '6.1  部署验收清单', '6.1  Danh sách nghiệm thu triển khai'));

body.push(...biPair(
  '部署完成后，请按以下清单逐项确认，全部通过方可交付使用。',
  'Sau khi triển khai xong, xác nhận từng mục theo danh sách dưới đây, tất cả đạt mới bàn giao sử dụng.'
));

body.push(biTable(
  [
    { zh: '序号', vi: 'STT' },
    { zh: '检查项', vi: 'Hạng mục kiểm tra' },
    { zh: '验证方法', vi: 'Cách kiểm tra' },
    { zh: '预期结果', vi: 'Kết quả mong đợi' },
  ],
  [
    [{ zh: '1', vi: '1' }, { zh: '数据库连接正常', vi: 'Kết nối CSDL bình thường' }, { zh: '查看启动日志', vi: 'Xem log khởi động' }, { zh: '无数据库报错', vi: 'Không báo lỗi CSDL' }],
    [{ zh: '2', vi: '2' }, { zh: 'HTTP 端口监听', vi: 'Cổng HTTP đang lắng nghe' }, { zh: 'netstat -ano | findstr 3000', vi: 'netstat -ano | findstr 3000' }, { zh: '出现 LISTENING', vi: 'Xuất hiện LISTENING' }],
    [{ zh: '3', vi: '3' }, { zh: 'HTTPS 端口监听', vi: 'Cổng HTTPS đang lắng nghe' }, { zh: 'netstat -ano | findstr 3443', vi: 'netstat -ano | findstr 3443' }, { zh: '出现 LISTENING', vi: 'Xuất hiện LISTENING' }],
    [{ zh: '4', vi: '4' }, { zh: 'PC 端可打开登录页', vi: 'PC mở được trang đăng nhập' }, { zh: '浏览器访问 http://服务器IP:3000', vi: 'Trình duyệt truy cập http://IP_máy_chủ:3000' }, { zh: '显示登录界面', vi: 'Hiển thị giao diện đăng nhập' }],
    [{ zh: '5', vi: '5' }, { zh: '管理员可登录', vi: 'Quản trị đăng nhập được' }, { zh: '输入 admin / admin', vi: 'Nhập admin / admin' }, { zh: '进入首页', vi: 'Vào trang chủ' }],
    [{ zh: '6', vi: '6' }, { zh: '三语切换正常', vi: 'Chuyển 3 ngôn ngữ bình thường' }, { zh: '切换中文/越南文/英文', vi: 'Chuyển Trung/Việt/Anh' }, { zh: '界面文字同步变化', vi: 'Chữ giao diện thay đổi theo' }],
    [{ zh: '7', vi: '7' }, { zh: '局域网其他电脑可访问', vi: 'Máy khác trong LAN truy cập được' }, { zh: '同网段电脑访问服务器 IP', vi: 'Máy cùng dải mạng truy cập IP máy chủ' }, { zh: '正常打开', vi: 'Mở bình thường' }],
    [{ zh: '8', vi: '8' }, { zh: 'PDA 可访问', vi: 'PDA truy cập được' }, { zh: 'PDA 访问 /pda/login', vi: 'PDA truy cập /pda/login' }, { zh: '正常打开', vi: 'Mở bình thường' }],
    [{ zh: '9', vi: '9' }, { zh: 'PDA 扫码可用', vi: 'PDA quét mã dùng được' }, { zh: '扫描任意条码', vi: 'Quét bất kỳ mã vạch' }, { zh: '内容自动填入输入框', vi: 'Nội dung tự điền vào ô nhập' }],
    [{ zh: '10', vi: '10' }, { zh: '基础业务闭环', vi: 'Nghiệp vụ cơ bản khép kín' }, { zh: '收货 → IQC → 上架 → 发料', vi: 'Nhận hàng → IQC → Lên kệ → Xuất kho' }, { zh: '库存数量正确变化', vi: 'Số lượng tồn thay đổi đúng' }],
  ],
  { widths: [8, 28, 38, 26] }
));

body.push(...biHeading(2, '6.2  常见问题排查', '6.2  Xử lý sự cố thường gặp'));

body.push(biTable(
  [
    { zh: '现象', vi: 'Hiện tượng' },
    { zh: '可能原因', vi: 'Nguyên nhân có thể' },
    { zh: '解决办法', vi: 'Cách giải quyết' },
  ],
  [
    [
      { zh: '启动报错 EADDRINUSE 端口被占用', vi: 'Lỗi EADDRINUSE cổng bị chiếm' },
      { zh: '3000 端口已被其他程序占用', vi: 'Cổng 3000 đã bị chương trình khác chiếm' },
      { zh: 'Windows：netstat -ano | findstr 3000 找到 PID，taskkill /PID xxx /F 结束；或修改 .env 中 SERVER_PORT', vi: 'Windows: netstat -ano | findstr 3000 tìm PID, taskkill /PID xxx /F; hoặc sửa SERVER_PORT trong .env' },
    ],
    [
      { zh: '页面能开但接口全部报错', vi: 'Mở được trang nhưng mọi API báo lỗi' },
      { zh: '数据库未连接成功', vi: 'Chưa kết nối được CSDL' },
      { zh: '检查 .env 中 DB_PASSWORD/DB_NAME；用 psql 手工测试能否连上', vi: 'Kiểm tra DB_PASSWORD/DB_NAME trong .env; dùng psql thử kết nối thủ công' },
    ],
    [
      { zh: '其他电脑打不开，本机可以', vi: 'Máy khác không mở được, máy chủ thì được' },
      { zh: '防火墙未放行，或 SERVER_HOST 不是 0.0.0.0', vi: 'Tường lửa chưa mở, hoặc SERVER_HOST không phải 0.0.0.0' },
      { zh: '按 3.5 / 4.6 节放行端口；确认 .env 中 SERVER_HOST=0.0.0.0', vi: 'Mở cổng theo mục 3.5 / 4.6; xác nhận SERVER_HOST=0.0.0.0' },
    ],
    [
      { zh: '登录提示账号或密码错误', vi: 'Đăng nhập báo sai tài khoản hoặc mật khẩu' },
      { zh: '数据库未初始化，或已被改过密码', vi: 'CSDL chưa khởi tạo, hoặc mật khẩu đã bị đổi' },
      { zh: '重新执行 npx ts-node server/scripts/init-db.ts（幂等，不会覆盖已有数据）', vi: 'Chạy lại npx ts-node server/scripts/init-db.ts (idempotent, không ghi đè dữ liệu có sẵn)' },
    ],
    [
      { zh: '登录后自动跳回登录页', vi: 'Đăng nhập xong tự quay về trang đăng nhập' },
      { zh: 'JWT_SECRET 被修改，旧令牌失效', vi: 'JWT_SECRET bị đổi, token cũ mất hiệu lực' },
      { zh: '清空浏览器缓存后重新登录即可', vi: 'Xóa cache trình duyệt rồi đăng nhập lại' },
    ],
    [
      { zh: 'PDA 摄像头无法调用', vi: 'Camera PDA không gọi được' },
      { zh: '未使用 HTTPS 访问', vi: 'Chưa truy cập qua HTTPS' },
      { zh: '改用 https://服务器IP:3443/pda/login，并按 5.2 节安装证书', vi: 'Đổi sang https://IP_máy_chủ:3443/pda/login, cài chứng chỉ theo mục 5.2' },
    ],
    [
      { zh: 'HTTPS 提示证书不受信任', vi: 'HTTPS báo chứng chỉ không đáng tin' },
      { zh: '服务器 IP 变化导致证书重签', vi: 'IP máy chủ thay đổi khiến chứng chỉ được ký lại' },
      { zh: '重新访问 /cert 下载并安装新证书', vi: 'Truy cập lại /cert tải và cài chứng chỉ mới' },
    ],
    [
      { zh: '页面显示 xxx.yyy 形式的原始键名', vi: 'Trang hiển thị tên khóa gốc dạng xxx.yyy' },
      { zh: '前端语言包缺少对应翻译键', vi: 'Gói ngôn ngữ frontend thiếu khóa dịch tương ứng' },
      { zh: '联系开发人员补充 client/src/i18n/locales 下三份语言包的键', vi: 'Liên hệ lập trình viên bổ sung khóa trong ba gói ngôn ngữ ở client/src/i18n/locales' },
    ],
    [
      { zh: '筛选/查询结果与预期不符', vi: 'Kết quả lọc/truy vấn không như mong đợi' },
      { zh: '浏览器缓存了旧版前端代码', vi: 'Trình duyệt cache mã frontend phiên bản cũ' },
      { zh: '按 Ctrl + F5 强制刷新；或在开发者工具 Network 中勾选 Disable cache 后刷新', vi: 'Nhấn Ctrl + F5 làm mới cưỡng bức; hoặc tích Disable cache trong Network của DevTools rồi làm mới' },
    ],
  ],
  { widths: [24, 28, 48] }
));

body.push(...biHeading(2, '6.3  日志查看', '6.3  Xem log'));

body.push(biTable(
  [
    { zh: '部署方式', vi: 'Phương thức triển khai' },
    { zh: '日志位置 / 查看命令', vi: 'Vị trí log / lệnh xem' },
  ],
  [
    [{ zh: 'Windows 直接运行', vi: 'Chạy trực tiếp trên Windows' }, { zh: '启动窗口直接输出；同时写入工程目录 logs/ 文件夹', vi: 'Xuất trực tiếp ở cửa sổ khởi động; đồng thời ghi vào thư mục logs/ của dự án' }],
    [{ zh: 'Windows 计划任务', vi: 'Task Scheduler Windows' }, { zh: '查看工程目录 logs/ 下的日志文件', vi: 'Xem tệp log trong thư mục logs/ của dự án' }],
    [{ zh: 'PM2（Linux 推荐）', vi: 'PM2 (khuyến nghị trên Linux)' }, { zh: 'pm2 logs wms（实时）；pm2 logs wms --lines 200（看最近 200 行）', vi: 'pm2 logs wms (thời gian thực); pm2 logs wms --lines 200 (xem 200 dòng gần nhất)', mono: true }],
    [{ zh: 'systemd（Linux 可选）', vi: 'systemd (tùy chọn Linux)' }, { zh: 'journalctl -u wms -f -n 200', vi: 'journalctl -u wms -f -n 200', mono: true }],
  ],
  { widths: [32, 68] }
));

body.push(...callout('info',
  '.env 中的 LOG_REQUEST_BODY 与 LOG_RESPONSE_BODY 控制是否记录请求/响应报文体。生产环境如日志量过大、涉及敏感数据，建议将这两项设为 false。',
  'LOG_REQUEST_BODY và LOG_RESPONSE_BODY trong .env quyết định có ghi nội dung request/response không. Trong sản xuất nếu log quá nhiều hoặc chứa dữ liệu nhạy cảm, nên đặt hai mục này thành false.'
));

body.push(...biHeading(2, '6.4  数据备份', '6.4  Sao lưu dữ liệu'));

body.push(...biPair(
  '数据库是系统最核心的资产，强烈建议配置每日自动备份。备份文件建议保留最近 30 天，并定期拷贝到异地。',
  'CSDL là tài sản cốt lõi nhất của hệ thống, rất khuyến nghị cấu hình sao lưu tự động hàng ngày. Tệp sao lưu nên giữ 30 ngày gần nhất và định kỳ sao chép ra nơi khác.'
));

body.push(...biPair('Windows 备份命令（保存为 backup.bat，配合计划任务每日执行）：',
  'Lệnh sao lưu Windows (lưu thành backup.bat, kết hợp Task Scheduler chạy hàng ngày):'));
body.push(...codeBlock([
  '@echo off',
  'set BACKUP_DIR=D:\\WMS\\backups',
  'set STAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%',
  'set STAMP=%STAMP: =0%',
  '',
  '"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe" -U postgres -d wms -F c -f "%BACKUP_DIR%\\wms_%STAMP%.dump"',
  '',
  'echo Backup finished: %BACKUP_DIR%\\wms_%STAMP%.dump',
]));

body.push(...callout('warn',
  'pg_dump 执行时会提示输入数据库密码。自动化脚本中需设置环境变量 PGPASSWORD=你的密码，或使用 .pgpass 密码文件，否则计划任务会因等待输入而挂起。',
  'pg_dump sẽ yêu cầu nhập mật khẩu CSDL. Trong script tự động cần đặt biến môi trường PGPASSWORD=mật khẩu, hoặc dùng tệp .pgpass, nếu không task sẽ treo vì chờ nhập.'
));

body.push(...biPair('Linux 备份命令（配合 crontab 每日执行）：', 'Lệnh sao lưu Linux (kết hợp crontab chạy hàng ngày):'));
body.push(...codeBlock([
  '# 编辑定时任务：crontab -e',
  '# 每天凌晨 2 点备份',
  '0 2 * * * PGPASSWORD=你的密码 pg_dump -U postgres -d wms -F c -f /opt/wms/backups/wms_$(date +\\%Y\\%m\\%d).dump',
]));

body.push(...biPair('恢复备份（数据损坏或迁移时使用）：', 'Phục hồi sao lưu (dùng khi dữ liệu hỏng hoặc di chuyển):'));
body.push(...codeBlock([
  '# 1. 停止应用（Windows 关闭启动窗口 / Linux: pm2 stop wms）',
  '# 2. 创建新库并恢复',
  'createdb -U postgres wms_restore',
  'pg_restore -U postgres -d wms_restore -F c wms_20261008.dump',
  '# 3. 修改 .env 中 DB_NAME=wms_restore 后重启应用验证',
]));

body.push(...biHeading(2, '6.5  系统升级', '6.5  Nâng cấp hệ thống'));

body.push(...biPair(
  '当需要更新程序版本时，按以下流程操作，可最大限度降低停机时间和数据风险。',
  'Khi cần cập nhật phiên bản chương trình, thực hiện theo quy trình dưới đây để giảm tối đa thời gian dừng và rủi ro dữ liệu.'
));

body.push(...step('升级前先完整备份数据库（见 6.4 节），并保留旧版本的 dist 目录副本。',
  'Trước khi nâng cấp sao lưu đầy đủ CSDL (xem mục 6.4), và giữ bản sao thư mục dist phiên bản cũ.'));
body.push(...step('停止服务：Windows 关闭启动窗口；Linux 执行 pm2 stop wms。',
  'Dừng dịch vụ: Windows đóng cửa sổ khởi động; Linux chạy pm2 stop wms.'));
body.push(...step('用新版本代码覆盖 server、client、shared 等源码目录（保留 .env 与 backups）。',
  'Dùng mã phiên bản mới ghi đè các thư mục mã nguồn server, client, shared (giữ lại .env và backups).'));
body.push(...step('如新版本带有 DDL 变更脚本（存放于 server/database/*.sql），按文件名顺序手工执行。',
  'Nếu bản mới có script thay đổi DDL (trong server/database/*.sql), thực hiện thủ công theo thứ tự tên tệp.'));
body.push(...step('执行 npm install（依赖可能变化）→ npm run build。',
  'Chạy npm install (phụ thuộc có thể thay đổi) → npm run build.'));
body.push(...step('重新启动服务，按 6.1 节验收清单验证，重点验证本次改动相关功能。',
  'Khởi động lại dịch vụ, kiểm tra theo danh sách nghiệm thu mục 6.1, tập trung chức năng liên quan thay đổi lần này.'));
body.push(...step('如出现严重问题无法快速修复，回滚：恢复 dist 旧副本 → 恢复数据库备份 → 重启。',
  'Nếu có sự cố nghiêm trọng không sửa nhanh được, khôi phục: phục hồi bản dist cũ → phục hồi bản sao CSDL → khởi động lại.'));

body.push(...callout('info',
  '系统未使用迁移框架，数据库结构变更通过 server/database 目录下的 .sql 文件手工执行。升级时请务必向开发人员确认是否需要执行相关 SQL。',
  'Hệ thống không dùng framework migration, thay đổi cấu trúc CSDL thực hiện thủ công qua tệp .sql trong server/database. Khi nâng cấp nhất định phải xác nhận với lập trình viên có cần chạy SQL liên quan không.'
));

// ---------- 附录 ----------
body.push(new Paragraph({ pageBreakBefore: true, children: [t('')] }));
body.push(...biHeading(1, '附录  命令速查卡', 'Phụ lục  Thẻ tra cứu lệnh nhanh'));

body.push(...biHeading(2, 'A.1  部署全流程命令', 'A.1  Lệnh toàn bộ quy trình triển khai'));
body.push(...codeBlock([
  '# ---- Windows ----',
  '# 双击 start.bat 即可（检查环境 → 安装依赖 → 配置向导 → 构建 → 初始化数据库 → 启动）',
  '# 放行防火墙：',
  'netsh advfirewall firewall add rule name="WMS-HTTP-3000" dir=in action=allow protocol=TCP localport=3000',
  'netsh advfirewall firewall add rule name="WMS-HTTPS-3443" dir=in action=allow protocol=TCP localport=3443',
  '',
  '# ---- Linux ----',
  'sudo mkdir -p /opt/wms && cd /opt/wms',
  'npm install',
  'cp .env.example .env && vi .env',
  'npx ts-node server/scripts/init-db.ts',
  'npm run build',
  'sudo npm install -g pm2',
  'pm2 start dist/main.js --name wms',
  'pm2 save && pm2 startup',
  'sudo ufw allow 3000/tcp && sudo ufw allow 3443/tcp && sudo ufw reload',
]));

body.push(...biHeading(2, 'A.2  常用运维命令', 'A.2  Lệnh vận hành thường dùng'));

body.push(biTable(
  [
    { zh: '场景', vi: 'Tình huống' },
    { zh: 'Windows', vi: 'Windows' },
    { zh: 'Linux (PM2)', vi: 'Linux (PM2)' },
  ],
  [
    [{ zh: '启动服务', vi: 'Khởi động dịch vụ' }, { zh: '双击 start.bat', vi: 'Nhấp đúp start.bat' }, { zh: 'pm2 start dist/main.js --name wms', vi: 'pm2 start dist/main.js --name wms', mono: true }],
    [{ zh: '停止服务', vi: 'Dừng dịch vụ' }, { zh: '关闭启动窗口', vi: 'Đóng cửa sổ khởi động' }, { zh: 'pm2 stop wms', vi: 'pm2 stop wms', mono: true }],
    [{ zh: '重启服务', vi: 'Khởi động lại' }, { zh: '关闭窗口后重新双击 start.bat', vi: 'Đóng cửa sổ rồi nhấp đúp lại start.bat' }, { zh: 'pm2 restart wms', vi: 'pm2 restart wms', mono: true }],
    [{ zh: '查看状态', vi: 'Xem trạng thái' }, { zh: 'netstat -ano | findstr 3000', vi: 'netstat -ano | findstr 3000', mono: true }, { zh: 'pm2 list', vi: 'pm2 list', mono: true }],
    [{ zh: '查看日志', vi: 'Xem log' }, { zh: 'logs/ 目录', vi: 'thư mục logs/' }, { zh: 'pm2 logs wms', vi: 'pm2 logs wms', mono: true }],
    [{ zh: '强制结束端口占用', vi: 'Buộc kết thúc chiếm cổng' }, { zh: 'taskkill /PID xxx /F', vi: 'taskkill /PID xxx /F', mono: true }, { zh: 'kill -9 $(lsof -t -i:3000)', vi: 'kill -9 $(lsof -t -i:3000)', mono: true }],
  ],
  { widths: [22, 36, 42] }
));

body.push(...biHeading(2, 'A.3  关键路径速查', 'A.3  Tra cứu đường dẫn quan trọng'));

body.push(biTable(
  [
    { zh: '路径', vi: 'Đường dẫn' },
    { zh: '说明', vi: 'Mô tả' },
  ],
  [
    [{ zh: '.env', vi: '.env', mono: true }, { zh: '环境变量配置（数据库、端口、密钥）', vi: 'Cấu hình biến môi trường (CSDL, cổng, khóa)' }],
    [{ zh: 'dist/main.js', vi: 'dist/main.js', mono: true }, { zh: '后端入口，生产环境启动文件', vi: 'Điểm vào backend, tệp khởi động sản xuất' }],
    [{ zh: 'dist/client/', vi: 'dist/client/', mono: true }, { zh: '前端构建产物，由后端托管', vi: 'Sản phẩm build frontend, do backend phục vụ' }],
    [{ zh: 'server/database/*.sql', vi: 'server/database/*.sql', mono: true }, { zh: '数据库结构变更脚本（手工执行）', vi: 'Script thay đổi cấu trúc CSDL (chạy thủ công)' }],
    [{ zh: 'server/scripts/init-db.ts', vi: 'server/scripts/init-db.ts', mono: true }, { zh: '数据库初始化脚本（幂等）', vi: 'Script khởi tạo CSDL (idempotent)' }],
    [{ zh: 'ssl/wms-cert.pfx', vi: 'ssl/wms-cert.pfx', mono: true }, { zh: 'HTTPS 证书（自动生成/续签）', vi: 'Chứng chỉ HTTPS (tự tạo/gia hạn)' }],
    [{ zh: 'logs/', vi: 'logs/', mono: true }, { zh: '运行日志目录', vi: 'Thư mục log vận hành' }],
    [{ zh: '/cert', vi: '/cert', mono: true }, { zh: '证书下载页（HTTP 访问）', vi: 'Trang tải chứng chỉ (truy cập HTTP)' }],
  ],
  { widths: [32, 68] }
));

body.push(...biHeading(2, 'A.4  文档修订记录', 'A.4  Lịch sử sửa đổi tài liệu', { pageBreak: true }));

body.push(biTable(
  [
    { zh: '版本', vi: 'Phiên bản' },
    { zh: '日期', vi: 'Ngày' },
    { zh: '修订内容', vi: 'Nội dung sửa đổi' },
  ],
  [
    [{ zh: 'V1.0', vi: 'V1.0', bold: true }, { zh: '2026-10-08', vi: '2026-10-08', mono: true }, { zh: '首次发布：Windows / Linux 双路径部署、防火墙放行、开机自启、PDA 证书安装、验收清单、故障排查、数据备份与系统升级。', vi: 'Phát hành lần đầu: triển khai Windows/Linux, mở tường lửa, tự khởi động, cài chứng chỉ PDA, danh sách nghiệm thu, xử lý sự cố, sao lưu dữ liệu và nâng cấp hệ thống.' }],
    [{ zh: 'V1.1', vi: 'V1.1', bold: true }, { zh: '2026-10-12', vi: '2026-10-12', mono: true }, { zh: '① 第 3.3 / 3.4 节按启动脚本实际行为改写：配置改为交互式向导、启动流程由四步更正为六步、JWT 密钥改由向导自动生成；② 修正 4.5 节关于 start.sh 路径错误的失效说明；③ 同步同日安全加固版本（接口鉴权改为全局默认拒绝、修复查询注入风险、错误信息脱敏，出错只返回通用提示）。', vi: '① Viết lại mục 3.3 / 3.4 theo hành vi thực tế của script: cấu hình chuyển sang trình hướng dẫn, quy trình khởi động từ bốn bước sửa thành sáu bước, khóa JWT do trình hướng dẫn tự sinh; ② Sửa mục 4.5 về cảnh báo sai đường dẫn start.sh; ③ Đồng bộ bản gia cố bảo mật cùng ngày (xác thực API chuyển sang từ chối mặc định toàn cục, sửa rủi ro chèn truy vấn, che thông tin lỗi, lỗi chỉ trả về thông báo chung).' }],
    [{ zh: 'V1.2', vi: 'V1.2', bold: true }, { zh: '2026-10-14', vi: '2026-10-14', mono: true }, { zh: '① 第 5.2 节拆分为「安卓」「苹果 iPhone / iPad」两条安装路径，新增苹果端完整步骤（下载描述文件 → 通用 / VPN 与设备管理安装 → 通用 / 关于本机 / 证书信任设置开启完全信任），并补充苹果端典型失败原因提示；② 第 5.1 节机型对照表新增苹果 iPhone / iPad 一行，第 5.3 节系统要求同步标注 iOS 与 Safari；③ 修正全文有序步骤的编号：越南文译文行不再单独编号，且每个步骤列表各自从 1 开始（原为全文连续编号且译文行也占一个号）。', vi: '① Tách mục 5.2 thành hai hướng cài đặt "Android" và "iPhone / iPad của Apple", bổ sung đầy đủ các bước cho iOS (tải cấu hình → Cài đặt chung / VPN & Quản lý thiết bị cài đặt → Cài đặt chung / Giới thiệu / Cài đặt tin cậy chứng chỉ bật tin cậy hoàn toàn), kèm cảnh báo nguyên nhân thất bại thường gặp trên iPhone; ② Bảng so sánh loại máy ở mục 5.1 thêm dòng iPhone / iPad, mục 5.3 bổ sung yêu cầu iOS và Safari; ③ Sửa cách đánh số các bước trong toàn bộ tài liệu: dòng tiếng Việt không còn được đánh số riêng và mỗi danh sách bước đếm lại từ 1.' }],
  ],
  { widths: [12, 16, 72] }
));

body.push(spacer(300));
body.push(...callout('ok',
  '本指导书覆盖了 WMS 系统在本地服务器上的完整部署流程。如在实际操作中遇到本文未涉及的问题，请记录完整的报错信息与复现步骤，反馈给系统开发人员。',
  'Tài liệu này bao quát toàn bộ quy trình triển khai WMS trên máy chủ nội bộ. Nếu gặp vấn đề chưa đề cập trong quá trình thực hiện, vui lòng ghi lại thông tin lỗi đầy đủ và các bước tái hiện, phản hồi cho lập trình viên hệ thống.'
));

// ============================================================
//                 组装文档
// ============================================================
const doc = new Document({
  creator: 'WMS 项目组',
  title: 'WMS 系统本地服务器部署操作指导书（中越双语）',
  description: 'Hướng dẫn triển khai hệ thống WMS trên máy chủ nội bộ',
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 21 },
        paragraph: { spacing: { line: 300 } },
      },
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
      page: {
        margin: { top: convertMillimetersToTwip(22), bottom: convertMillimetersToTwip(20), left: convertMillimetersToTwip(20), right: convertMillimetersToTwip(20) },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 2 } },
          children: [t(ZH_ONLY ? 'WMS 系统部署操作指导书' : 'WMS 系统部署操作指导书 · Hướng dẫn triển khai hệ thống WMS', { size: 16, color: C.gray })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0 },
          children: [
            t('第 ', { size: 16, color: C.gray }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.gray, font: FONT }),
            t(ZH_ONLY ? ' 页  共 ' : ' 页 / Trang  共 ', { size: 16, color: C.gray }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: C.gray, font: FONT }),
            t(ZH_ONLY ? ' 页' : ' 页 · Trang', { size: 16, color: C.gray }),
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
