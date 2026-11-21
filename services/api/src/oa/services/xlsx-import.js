/**
 * xlsx → HTML（体系文件正文用）
 *
 * 设计口径与 `docx-import.js` 对齐：**只产出内联样式**，不依赖前端 CSS。
 * 前端正文区是原样插入一段 HTML，docx 与 xlsx 的产物必须能放在同一个容器里看起来是一套东西。
 *
 * 与 docx 的差别（Excel 的先天限制，非实现取舍）：
 *  - 取不到字体 / 加粗 / 底色 / 对齐（SheetJS 社区版只给样式索引，不解析 styles 表），
 *    所以统一「细边框 + 12px + 左对齐（数字右对齐）+ 垂直居中」；
 *  - 列宽：xlsx 绝大多数表单没写 <col>（`!cols` 为空），只能按内容长度反推；
 *  - 行高：有 `!rows[i].hpt` 就用，没有就让内容自然撑开。
 *
 * 关键点：`cell.w` 是 Excel 里显示出来的那份文本（千分位、日期格式、百分比都带上了），
 * 直接用它，比用 `cell.v` 再自己格式化更贴近原件。
 */

import * as XLSX from 'xlsx';

/** 东亚全角字符按 2 个宽度算，用于估列宽 */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

// 注意：这个串要塞进 style="..."，字体名必须用**单引号**。
// 用双引号会把 style 属性提前闭合，后面的 font-size / line-height 全部失效
// （表现为整表行高从 23px 变成 31px，且字体回落到浏览器默认衬线体）。
const FONT = "-apple-system,'Segoe UI','Microsoft YaHei','PingFang SC',Arial,sans-serif";
const BORDER = '#b0b7c2';
/** 单元格基础样式（空格子也用它，保证网格线连续） */
const TD = `border:1px solid ${BORDER};padding:3px 5px`;
/** 有内容的格子追加：垂直居中 + 保留 Excel 里的换行 */
const MIDDLE = ';vertical-align:middle;white-space:pre-wrap';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function visualWidth(str) {
  let w = 0;
  for (const ch of String(str)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

/** 单元格的显示文本 */
function cellText(cell) {
  if (!cell) return '';
  if (typeof cell.w === 'string' && cell.w !== '') return cell.w;
  if (cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'e') return String(cell.w || cell.v);
  return String(cell.v);
}

/** 数字型单元格右对齐，其余左对齐（Excel 默认习惯） */
function isNumericCell(cell) {
  if (!cell) return false;
  return cell.t === 'n' && !/%/.test(cell.z || '');
}

function hasAny(ws) {
  if (!ws || !ws['!ref']) return false;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cellText(cell).trim() !== '') return true;
    }
  }
  return false;
}

/**
 * 单张工作表 → HTML
 * @param {object} ws 工作表
 * @param {{showTitle?:boolean, title?:string, stats?:object}} opt
 */
function sheetToHtml(ws, opt = {}) {
  const stats = opt.stats;
  if (!ws || !ws['!ref']) return '';
  const range = XLSX.utils.decode_range(ws['!ref']);
  const R = range.e.r - range.s.r + 1;
  const C = range.e.c - range.s.c + 1;
  if (R <= 0 || C <= 0) return '';

  // ---- 1. 取成二维格网（相对坐标）----
  const grid = [];
  for (let r = 0; r < R; r++) {
    const row = new Array(C);
    for (let c = 0; c < C; c++) {
      row[c] = ws[XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })] || null;
    }
    grid.push(row);
  }

  // ---- 2. 合并单元格：左上角记 rowspan/colspan，其余位置标记跳过 ----
  const span = new Map();     // "r,c" → { rs, cs }
  const covered = new Set();  // 被合并区覆盖（非左上角）的位置
  for (const m of ws['!merges'] || []) {
    const r0 = m.s.r - range.s.r;
    const c0 = m.s.c - range.s.c;
    const r1 = Math.min(m.e.r - range.s.r, R - 1);
    const c1 = Math.min(m.e.c - range.s.c, C - 1);
    if (r0 < 0 || c0 < 0 || r0 >= R || c0 >= C) continue;
    const rs = r1 - r0 + 1;
    const cs = c1 - c0 + 1;
    if (rs < 1 || cs < 1) continue;
    if (rs === 1 && cs === 1) continue;
    span.set(r0 + ',' + c0, { rs, cs });
    for (let r = r0; r < r0 + rs; r++) {
      for (let c = c0; c < c0 + cs; c++) {
        if (r === r0 && c === c0) continue;
        covered.add(r + ',' + c);
      }
    }
  }

  // ---- 3. 裁掉四周的空白行/列（中间的空白行保留，那是表单的版式间距）----
  const rowUsed = new Array(R).fill(false);
  const colUsed = new Array(C).fill(false);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const key = r + ',' + c;
      if (covered.has(key)) { rowUsed[r] = true; colUsed[c] = true; continue; }
      if (cellText(grid[r][c]).trim() !== '') { rowUsed[r] = true; colUsed[c] = true; }
    }
  }
  let top = 0, bottom = R - 1, left = 0, right = C - 1;
  while (top <= bottom && !rowUsed[top]) top++;
  while (bottom >= top && !rowUsed[bottom]) bottom--;
  while (left <= right && !colUsed[left]) left++;
  while (right >= left && !colUsed[right]) right--;
  if (top > bottom || left > right) return '';

  const rows = bottom - top + 1;
  const cols = right - left + 1;

  // ---- 4. 估列宽：按内容视觉宽度反推（合并跨列的按列数均摊）----
  const colW = new Array(cols).fill(4);
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      const key = r + ',' + c;
      if (covered.has(key)) continue;
      const t = cellText(grid[r][c]);
      if (!t) continue;
      const sp = span.get(key);
      const cs = sp ? sp.cs : 1;
      const longest = Math.max(...t.split('\n').map(visualWidth));
      const share = longest / Math.max(1, cs);
      for (let k = 0; k < cs && c - left + k < cols; k++) {
        colW[c - left + k] = Math.max(colW[c - left + k], share);
      }
    }
  }
  // 文件里写了 <col> 宽度的直接采信（Excel 的"列宽"就是这个数，单位是字符），
  // 没写的按上面的内容估算 —— 等价于 Excel 的"最适合的列宽"。
  const colInfo = ws['!cols'] || [];
  const px = [];
  for (let i = 0; i < cols; i++) {
    const info = colInfo[range.s.c + left + i] || {};
    const wch = Number(info.wch || info.width || 0);
    const ch = wch > 0 ? wch : colW[i];
    // Excel：1 个字符 ≈ 7px（Calibri 11 口径），再加 5px 边框/内边距。
    // colW 里的中文已按 2 个字符宽计过，所以这里不必再区分中英文。
    px.push(Math.min(360, Math.max(46, Math.round(ch * 6.8 + 12))));
  }
  // 表格的自然宽度 = 各列宽之和。比正文区宽时**不压缩**，让正文区横向滚动（这就是 Excel 的样子）。
  const totalPx = px.reduce((a, b) => a + b, 0);

  // ---- 5. 逐行生成 ----
  const trHtml = [];
  let cellCount = 0;
  for (let r = top; r <= bottom; r++) {
    const tds = [];
    for (let c = left; c <= right; c++) {
      const key = r + ',' + c;
      if (covered.has(key)) continue;
      const cell = grid[r][c];
      const sp = span.get(key);
      const rs = sp ? sp.rs : 1;
      const cs = sp ? sp.cs : 1;
      const text = cellText(cell);
      const attrs =
        (rs > 1 ? ` rowspan="${rs}"` : '') +
        (cs > 1 ? ` colspan="${cs}"` : '');
      // 样式串要短：一张 5000 格的报表会被这段字符串放大成 1MB 正文。
      // 字体/行距统一放在 <table> 上让 td 继承，td 只留边框、内边距、垂直居中。
      //
      // 宽度必须写在 td 上，不能靠 colgroup 或内层 div —— 详情页正文由富文本编辑器
      // 只读渲染，schema 里没有 colgroup/div，两者都会被剥掉，只有 td 的内联样式能活下来。
      // auto 布局下 td 的 width 会被当作该列的最小宽度参考，正好用来兜住「4h/lần」这类窄列。
      const w = Math.min(360, Math.max(44, px.slice(c - left, c - left + cs).reduce((a, b) => a + b, 0)));
      const style = (text.trim() ? TD + MIDDLE + (isNumericCell(cell) ? ';text-align:right' : '') : TD) +
        `;width:${w}px`;
      tds.push(`<td${attrs} style="${style}">${esc(text) || '&nbsp;'}</td>`);
    }
    // 这一行一个格子都没吐出来，有两种可能，必须分开处理：
    //  ① 整行被上方的 rowspan 盖住（Excel 里"检测仪器 / 日期"竖跨两行的典型版式）
    //     → 必须留一个空 <tr>。否则 rowspan 会跨到**下一行**的行首，
    //       下一行的单元格被顶到右边，浏览器还会补出几列幽灵列，
    //       表现为表头被压成一条竖排窄条（FM-OP-EN-002-07 就是这样坏的）。
    //  ② 本来就是空行 → 丢掉（否则每张表都会多出成片的空行）。
    if (!tds.length) {
      let allCovered = true;
      for (let c = left; c <= right; c++) {
        if (!covered.has(r + ',' + c)) { allCovered = false; break; }
      }
      if (allCovered) trHtml.push('<tr></tr>');
      continue;
    }
    cellCount += tds.length;
    const hpt = ws['!rows'] && ws['!rows'][r] && ws['!rows'][r].hpt;
    const hStyle = hpt ? ` style="height:${Math.round(hpt * 1.333)}px"` : '';
    trHtml.push(`<tr${hStyle}>${tds.join('')}</tr>`);
  }

  const colsHtml = px.map((w) => `<col style="width:${w}px">`).join('');

  if (stats) {
    stats.rows += trHtml.length;
    stats.cells += cellCount;
  }

  // 多工作表：每张表前挂一条**醒目**的分节带。
  // 早先只写一行小字「工作表：xxx」，三张表紧挨着看上去就是一张超长表，
  // 用户反馈「系统把三个 sheet 合并成一个了」——不是数据合并，是视觉上没分开。
  const titleHtml = opt.showTitle
    ? `<div style="margin:${opt.index === 1 ? 4 : 22}px 0 8px;padding:7px 12px;` +
      `background:#f1f5fb;border-left:3px solid #4a7cf0;border-radius:3px;` +
      `font-size:13px;font-weight:600;color:#1f2d3d">` +
      `工作表 ${opt.index}/${opt.total}　${esc(opt.title || '')}</div>`
    : '';

  // 表格布局：刻意**不用** table-layout:fixed。
  // 文件详情页的正文由富文本编辑器组件只读渲染，它的 schema 里没有 colgroup/col，
  // 会被直接丢弃；一旦 fixed 布局失去 col 宽度，32 列就被均分成 50px，中文字全挤成一列。
  //
  // 列宽写在 td 上（编辑器只保留 td 的内联样式），表格用 width:100% + auto。
  // **min-width = 各列自然宽之和**：
  //   · 窄表（自然宽 < 正文区）→ 仍按 100% 铺满，读起来像正文；
  //   · 宽表（温湿度 63 列、光亮度 53 列）→ 保持 Excel 的原始列宽，正文区横向滚动，
  //     不再把 63 列压进 1215px（那样表头必然折成竖排）。
  //   滚动容器由前端 `oa-doc-paged-view.js` 在渲染后补（存库 HTML 里的 <div> 会被
  //   详情页的清洗器剥掉，只有 JS 后处理创建的 div 才活得下来）。
  return (
    `${titleHtml}<div style="overflow-x:auto;margin:0 0 12px;padding-bottom:2px">` +
    `<table style="border-collapse:collapse;table-layout:auto;width:100%;min-width:${totalPx}px;` +
    `font-family:${FONT};font-size:12px;line-height:1.35;word-break:break-word">` +
    `<colgroup>${colsHtml}</colgroup><tbody>${trHtml.join('')}</tbody></table></div>`
  );
}

/**
 * 工作簿 → HTML
 *
 * @param {Buffer} buffer  xlsx 文件内容
 * @param {{title?:string}} [opts]
 * @returns {{html:string, sheets:number, rows:number, cells:number, empty:boolean}}
 *   注意：**返回对象不是字符串**，取值用 `.html`。
 */
export function xlsxToHtml(buffer, opts = {}) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new Error('Excel 解析失败：' + e.message);
  }

  const usable = wb.SheetNames.filter((n) => hasAny(wb.Sheets[n]));
  const stats = { sheets: 0, rows: 0, cells: 0 };
  const parts = [];
  const showTitle = usable.length > 1;

  let sheetNo = 0;
  for (const name of usable) {
    const html = sheetToHtml(wb.Sheets[name], {
      showTitle, title: name, index: ++sheetNo, total: usable.length, stats,
    });
    if (html) {
      parts.push(html);
      stats.sheets++;
    }
  }

  const html = parts.join('\n');
  return { html, ...stats, empty: !html.trim() };
}

export default { xlsxToHtml };
