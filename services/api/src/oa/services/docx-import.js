// ============================================================
// docx → 高保真 HTML（保留 Word 排版，供「导入正文」使用）
// ------------------------------------------------------------
// 背景（用户 2026-10-30 反馈「富文本导入后与原文档格式完全不一致」）：
//   原导入链路是 mammoth 默认转换 —— 只保留语义（p / h1 / table），
//   字号、字体、颜色、对齐、缩进、行距、段落边框、单元格边框全部丢弃。
//   实测 DT-MM-001 质量环境手册：字号 1716 处、字体 1804 处、颜色 1498 处、
//   对齐 2478 处、缩进 1690 处、间距 2680 处、单元格边框 218 处 —— 全被吃掉，
//   所以导入后只剩「一堆同样大小的黑字」。
//
// 本模块直接解析 OOXML：document.xml + styles.xml + theme1.xml + rels + media，
// 把 w:pPr / w:rPr / w:tblPr / w:tcPr 逐项映射成**内联 CSS**。
//
// 三条硬约束（改了会静默失效，务必遵守）：
//   1) 输出必须能通过前端 DOMPurify 白名单（richText-*.js 里的 ALLOWED_TAGS/ALLOWED_ATTR）：
//      只能用 p / h1-h6 / table / thead / tbody / tr / td / th / span / b / i / u / s /
//      br / img / a / sup / sub / mark，样式只能写 style，**不能用 class、div、colgroup、col**。
//   2) 不依赖任何浏览器 API，Node 端直接可跑（验收脚本要对拍）。
//   3) 表格宽度用百分比（相对容器），列宽按 w:tblGrid 比例分配 —— 嵌进编辑器不失真、不横向溢出。
//
// 分页（2026-10-30 追加，用户要求「严格对照 Word 分页」）：
//   Word 保存时会在 document.xml 里插 <w:lastRenderedPageBreak/> ——
//   这是它上一次排版时每一页的断点，属于文档自带的分页真值，不是估算。
//   DT-MM-001 质量环境手册：97 个 lastRenderedPageBreak + 3 个 <w:br w:type="page"/>
//   + 段落级 <w:pageBreakBefore/> + 段落内 <w:sectPr/>（分节符），四类都当硬分页。
//   实测断点分布：99 个落在正文段落内、仅 1 个落在表格单元格里（表格内不切，
//   否则会撕裂 <table>，页数少 1 页可接受）。
//   段落被页边界切开时输出两个 p，后续那半段去掉首行缩进与段前距（等价 Word 的续排）。
//
// 已知不还原（Word 里也没有对应语义，或前端白名单不允许）：
//   · 页眉页脚（页码、logo）—— 属于页面装饰，不属于正文
//   · 制表位精确跳位 —— 用固定宽 spacer 近似（目录里页码列会略偏）
//   · 主题色（w:themeColor）—— 只认 w:val 的 RGB
// ============================================================
import JSZip from 'jszip';

const TW_PER_PT = 20;      // twips / pt
const EMU_PER_PT = 12700;  // EMU / pt

/**
 * 分页哨兵：先以控制字符在 HTML 字符串里标记页边界，最后由 convertBody 统一切分。
 * 用 \u0001 而不是注释/元素，是因为它不会被 DOMPurify 动到、也不会被 escText 产生。
 *
 * 分级是有原因的（DT-MM-001 实测）：
 *   HARD = 显式分页符 / 段前分页 / 分节符 —— 文档明确要求换页，永远生效。
 *   SOFT = <w:lastRenderedPageBreak/> —— Word 上次排版留下的断点快照，内容改过就会过期。
 *          软件封面后面那个空段，SOFT 断点会切出一张空白页，而 Word 实际只有 98 页；
 *          所以 SOFT 切出「无可见内容」的页时不予采纳，直接并回上一页。
 */
const PAGE_MARK = '\u0001';
const SOFT_MARK = '\u0002';

/** twips → mm（Word 页面尺寸/页边距都是 twips） */
const twMm = (tw) => Math.round((tw / 1440) * 25.4 * 100) / 100;

/* ------------------------------------------------------------------ 1. 极简 XML 解析 */

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    switch (g) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'nbsp': return '\u00a0';
      default: return m;
    }
  });
}

/** 找到标签的 '>' —— 跳过属性值引号里的 '>' */
function findTagEnd(xml, from) {
  let quote = '';
  for (let i = from + 1; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return xml.length - 1;
}

function parseAttrs(raw) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(raw))) {
    out[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return out;
}

/**
 * 解析成 { n: 标签名, a: 属性, c: 子节点[] }。
 * 文本节点用 { n: '#text', t: 文本 }。足够应付 OOXML（无 DTD、无外部实体）。
 */
export function parseXml(xml) {
  const root = { n: '#root', a: {}, c: [] };
  const stack = [root];
  const addText = (t) => {
    if (!t) return;
    const decoded = decodeEntities(t);
    if (!decoded) return;
    stack[stack.length - 1].c.push({ n: '#text', t: decoded });
  };
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { addText(xml.slice(i)); break; }
    if (lt > i) addText(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt);
      const t = xml.slice(lt + 9, e < 0 ? xml.length : e);
      if (t) stack[stack.length - 1].c.push({ n: '#text', t });
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt);
      i = e < 0 ? xml.length : e + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const e = xml.indexOf('>', lt);
      i = e < 0 ? xml.length : e + 1;
      continue;
    }
    const gt = findTagEnd(xml, lt);
    const raw = xml.slice(lt + 1, gt);
    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].n === name) { stack.length = k; break; }
      }
    } else {
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const sp = body.search(/\s/);
      const name = (sp < 0 ? body : body.slice(0, sp)).trim();
      const attrs = sp < 0 ? {} : parseAttrs(body.slice(sp));
      const node = { n: name, a: attrs, c: [] };
      stack[stack.length - 1].c.push(node);
      if (!selfClose) stack.push(node);
    }
    i = gt + 1;
  }
  return root;
}

/* ------------------------------------------------------------------ 2. 节点读取工具 */

const el = (n, name) => (n && n.c ? n.c.find((x) => x.n === name) || null : null);
const els = (n, name) => (n && n.c ? n.c.filter((x) => x.n === name) : []);
const av = (n, k) => (n && n.a && n.a[k] !== undefined ? n.a[k] : undefined);
const wv = (n) => av(n, 'w:val');
const num = (v, dv = 0) => { const x = Number(v); return Number.isFinite(x) ? x : dv; };
const pt = (twips) => Math.round((twips / TW_PER_PT) * 100) / 100;
const r2 = (v) => Math.round(v * 100) / 100;

/** w:b / w:i / w:u 这类开关元素：无 w:val 视为开，val=0/false/off 视为关 */
function onOff(node) {
  if (!node) return undefined;
  const v = wv(node);
  if (v === undefined) return true;
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

function normColor(v) {
  if (!v || v === 'auto') return null;
  const s = String(v).replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? '#' + s : null;
}

const NAME_COLORS = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF',
  blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000',
  white: '#FFFFFF',
};

const HIGHLIGHT_MAP = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF',
  blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000',
  white: '#FFFFFF', none: null,
};

/* ------------------------------------------------------------------ 3. 样式表 / 主题 */

function buildStyles(stylesXml) {
  const empty = { docRPr: null, docPPr: null, defs: {} };
  if (!stylesXml) return empty;
  const root = parseXml(stylesXml);
  const doc = el(root, 'w:styles');
  if (!doc) return empty;
  const dd = el(doc, 'w:docDefaults');
  const defs = {};
  for (const st of els(doc, 'w:style')) {
    const id = av(st, 'w:styleId');
    if (!id) continue;
    defs[id] = {
      id,
      type: av(st, 'w:type'),
      basedOn: wv(el(st, 'w:basedOn')),
      name: wv(el(st, 'w:name')) || '',
      pPr: el(st, 'w:pPr'),
      rPr: el(st, 'w:rPr'),
      tblPr: el(st, 'w:tblPr'),
    };
  }
  return {
    docRPr: el(el(dd, 'w:rPrDefault'), 'w:rPr'),
    docPPr: el(el(dd, 'w:pPrDefault'), 'w:pPr'),
    defs,
    root: doc,
  };
}

/** 样式继承链：由根到自身（含 basedOn 多层），并防环 */
function styleChain(styles, id, seen) {
  const out = [];
  let cur = id;
  const guard = seen || new Set();
  while (cur && styles.defs[cur] && !guard.has(cur)) {
    guard.add(cur);
    const def = styles.defs[cur];
    out.unshift(def);
    cur = def.basedOn;
  }
  return out;
}

function buildTheme(themeXml) {
  const out = { major: { latin: null, ea: null }, minor: { latin: null, ea: null } };
  if (!themeXml) return out;
  const root = parseXml(themeXml);
  const scheme = (() => {
    const walk = (n) => {
      if (!n || !n.c) return null;
      if (n.n === 'a:fontScheme') return n;
      for (const k of n.c) { const r = walk(k); if (r) return r; }
      return null;
    };
    return walk(root);
  })();
  if (!scheme) return out;
  for (const which of ['major', 'minor']) {
    const fam = el(scheme, 'a:' + which + 'Font');
    if (!fam) continue;
    out[which].latin = av(el(fam, 'a:latin'), 'typeface') || null;
    let ea = av(el(fam, 'a:ea'), 'typeface') || null;
    if (!ea) {
      // a:ea 为空时按脚本回落：Hans → 宋体
      for (const f of els(fam, 'a:font')) {
        if (av(f, 'script') === 'Hans') { ea = av(f, 'typeface') || null; break; }
      }
    }
    out[which].ea = ea;
  }
  return out;
}

/* ------------------------------------------------------------------ 4. run / paragraph 属性 */

function readRPr(rPr, out) {
  if (!rPr) return out;
  const f = el(rPr, 'w:rFonts');
  if (f) {
    if (av(f, 'w:ascii') !== undefined) out.ascii = av(f, 'w:ascii');
    if (av(f, 'w:hAnsi') !== undefined) out.hAnsi = av(f, 'w:hAnsi');
    if (av(f, 'w:eastAsia') !== undefined) out.eastAsia = av(f, 'w:eastAsia');
    if (av(f, 'w:asciiTheme') !== undefined) out.asciiTheme = av(f, 'w:asciiTheme');
    if (av(f, 'w:eastAsiaTheme') !== undefined) out.eastAsiaTheme = av(f, 'w:eastAsiaTheme');
    if (av(f, 'w:hint') !== undefined) out.hint = av(f, 'w:hint');
  }
  const sz = el(rPr, 'w:sz');
  if (sz) out.size = num(wv(sz)) / 2;
  const b = el(rPr, 'w:b');
  if (b) out.bold = onOff(b);
  const i = el(rPr, 'w:i');
  if (i) out.italic = onOff(i);
  const u = el(rPr, 'w:u');
  if (u) {
    const v = wv(u);
    out.underline = v === undefined ? true : (v !== 'none' && v !== '0');
  }
  const strike = el(rPr, 'w:strike');
  if (strike) out.strike = onOff(strike);
  const color = el(rPr, 'w:color');
  if (color) out.color = normColor(wv(color));
  const hl = el(rPr, 'w:highlight');
  if (hl) {
    const k = String(wv(hl) || '').toLowerCase();
    if (HIGHLIGHT_MAP[k] !== undefined) out.bg = HIGHLIGHT_MAP[k];
  }
  const shd = el(rPr, 'w:shd');
  if (shd) {
    const fill = normColor(av(shd, 'w:fill'));
    if (fill) out.bg = fill;
  }
  const sp = el(rPr, 'w:spacing');
  if (sp) {
    const v = wv(sp);
    if (v !== undefined) out.charSpace = num(v) / TW_PER_PT; // 1/20 pt
  }
  const va = el(rPr, 'w:vertAlign');
  if (va) {
    const v = wv(va);
    if (v === 'superscript') out.vertAlign = 'super';
    else if (v === 'subscript') out.vertAlign = 'sub';
  }
  const caps = el(rPr, 'w:caps');
  if (caps && onOff(caps)) out.caps = true;
  return out;
}

function readPPr(pPr, out) {
  if (!pPr) return out;
  const jc = el(pPr, 'w:jc');
  if (jc) {
    const v = wv(jc);
    out.align = ({ left: 'left', start: 'left', right: 'right', end: 'right', center: 'center', both: 'justify', distribute: 'justify', mediumKashida: 'justify', numTab: 'left', highKashida: 'justify', lowKashida: 'justify', thaiDistribute: 'justify' })[v] || 'left';
  }
  const ind = el(pPr, 'w:ind');
  if (ind) {
    const left = av(ind, 'w:left') !== undefined ? av(ind, 'w:left') : av(ind, 'w:start');
    const right = av(ind, 'w:right') !== undefined ? av(ind, 'w:right') : av(ind, 'w:end');
    if (left !== undefined) out.left = num(left);
    if (right !== undefined) out.right = num(right);
    if (av(ind, 'w:firstLine') !== undefined) out.firstLine = num(av(ind, 'w:firstLine'));
    if (av(ind, 'w:hanging') !== undefined) out.hanging = num(av(ind, 'w:hanging'));
    // 字符单位的缩进（leftChars/firstLineChars）按字号折算，避免只有首行缩进没生效
    if (av(ind, 'w:leftChars') !== undefined && out.left === undefined) {
      out.leftChars = num(av(ind, 'w:leftChars')) / 100;
    }
    if (av(ind, 'w:firstLineChars') !== undefined && out.firstLine === undefined) {
      out.firstLineChars = num(av(ind, 'w:firstLineChars')) / 100;
    }
  }
  const sp = el(pPr, 'w:spacing');
  if (sp) {
    if (av(sp, 'w:before') !== undefined) out.before = num(av(sp, 'w:before'));
    if (av(sp, 'w:after') !== undefined) out.after = num(av(sp, 'w:after'));
    if (av(sp, 'w:line') !== undefined) {
      out.line = num(av(sp, 'w:line'));
      out.lineRule = av(sp, 'w:lineRule') || 'auto';
    }
    if (av(sp, 'w:beforeLines') !== undefined) out.beforeLines = num(av(sp, 'w:beforeLines')) / 100;
    if (av(sp, 'w:afterLines') !== undefined) out.afterLines = num(av(sp, 'w:afterLines')) / 100;
  }
  const bdr = el(pPr, 'w:pBdr');
  if (bdr) {
    out.borders = {};
    for (const side of ['top', 'left', 'bottom', 'right']) {
      const b = el(bdr, 'w:' + side);
      if (!b) continue;
      const v = wv(b);
      if (!v || v === 'none' || v === 'nil') continue;
      out.borders[side] = {
        style: v,
        sz: num(av(b, 'w:sz'), 4),
        color: normColor(av(b, 'w:color')) || '#000000',
        space: num(av(b, 'w:space'), 0),
      };
    }
  }
  const shd = el(pPr, 'w:shd');
  if (shd) { const fill = normColor(av(shd, 'w:fill')); if (fill) out.bg = fill; }
  const ol = el(pPr, 'w:outlineLvl');
  if (ol) out.outlineLvl = num(wv(ol), -1);
  // 制表位：目录靠「右制表位」把页码顶到右边距。富文本里没有制表符概念，
  // 这里把 right 制表位记下来，段落渲染时把 tab 之后的内容 float 到右边界。
  const tabs = el(pPr, 'w:tabs');
  if (tabs) {
    const list = els(tabs, 'w:tab').map((t) => ({
      val: av(t, 'w:val') || 'left',
      pos: num(av(t, 'w:pos')),
      leader: av(t, 'w:leader') || 'none',
    }));
    if (list.length) out.tabs = list;
  }
  return out;
}

/* ------------------------------------------------------------------ 5. 主转换器 */

class Converter {
  constructor(opts) {
    this.styles = opts.styles;
    this.theme = opts.theme;
    this.media = opts.media || {};      // rId -> dataURI
    this.stats = { p: 0, runs: 0, tables: 0, cells: 0, images: 0, spans: 0, stripped: 0, pageBreaks: 0, pages: 0, tableSplits: 0 };
    this.pages = null;
    this.defaultRun = this.resolveDefaultRun();
  }

  /** 文档默认字体/字号（docDefaults + 主题） */
  resolveDefaultRun() {
    const o = { size: 11, ascii: null, hAnsi: null, eastAsia: null };
    readRPr(this.styles.docRPr, o);
    const t = this.theme;
    if (!o.ascii) o.ascii = t.minor.latin || 'Calibri';
    if (!o.hAnsi) o.hAnsi = o.ascii;
    if (!o.eastAsia) o.eastAsia = t.minor.ea || '宋体';
    if (!o.size) o.size = 11;
    return o;
  }

  fontFamily(p) {
    const hill = p.hint || undefined;
    const asc = p.ascii || p.hAnsi || this.defaultRun.ascii;
    const ea = p.eastAsia || this.defaultRun.eastAsia;
    const list = [];
    const push = (t) => { if (t && list.indexOf(t) < 0) list.push(t); };
    if (hill === 'eastAsia') { push(ea); push(asc); } else { push(asc); push(ea); }
    return list.map((n) => (/\s/.test(n) ? `'${n}'` : n)).join(',');
  }

  /** 有效 run 属性：docDefaults → 段落样式链 → 段落标记 rPr → run 自身 */
  resolveRun(styleIds, paraRPr, runRPr) {
    const base = {
      ascii: this.defaultRun.ascii, hAnsi: this.defaultRun.hAnsi, eastAsia: this.defaultRun.eastAsia,
      size: this.defaultRun.size, bold: false, italic: false, underline: false, strike: false,
      color: null, bg: null, charSpace: 0, vertAlign: null,
    };
    readRPr(this.styles.docRPr, base);
    for (const id of styleIds) readRPr(this.styles.defs[id] && this.styles.defs[id].rPr, base);
    readRPr(paraRPr, base);
    readRPr(runRPr, base);
    if (!base.size) base.size = this.defaultRun.size;
    return base;
  }

  /** 只输出与段落默认不同的声明，压体积 */
  runCss(p, base) {
    const d = [];
    if (p.bold !== base.bold) d.push('font-weight:' + (p.bold ? '700' : '400'));
    if (p.italic !== base.italic) d.push('font-style:' + (p.italic ? 'italic' : 'normal'));
    const deco = [];
    if (p.underline) deco.push('underline');
    if (p.strike) deco.push('line-through');
    const bdeco = [];
    if (base.underline) bdeco.push('underline');
    if (base.strike) bdeco.push('line-through');
    if (deco.join(' ') !== bdeco.join(' ')) d.push('text-decoration:' + (deco.length ? deco.join(' ') : 'none'));
    if (r2(p.size) !== r2(base.size)) d.push('font-size:' + r2(p.size) + 'pt');
    const fam = this.fontFamily(p);
    if (fam !== this.fontFamily(base)) d.push('font-family:' + fam);
    if (p.color && p.color !== base.color) d.push('color:' + p.color);
    if (p.bg && p.bg !== base.bg) d.push('background-color:' + p.bg);
    if (r2(p.charSpace) !== r2(base.charSpace)) d.push('letter-spacing:' + r2(p.charSpace) + 'pt');
    if (p.vertAlign !== base.vertAlign) {
      d.push('vertical-align:' + (p.vertAlign || 'baseline'));
      if (p.vertAlign) d.push('font-size:' + r2(p.size * 0.65) + 'pt');
    }
    return d.join(';');
  }

  paraCss(p, cont) {
    const d = [];
    d.push('text-align:' + (p.align || 'left'));
    // cont = 这一半是被页边界切开后的续排段：Word 里续排不留段前距、不做首行缩进
    const before = cont ? 0 : (p.before !== undefined ? pt(p.before) : 0);
    const after = p.after !== undefined ? pt(p.after) : 0;
    d.push(`margin:${before}pt 0 ${after}pt 0`);
    if (p.left) d.push('margin-left:' + pt(p.left) + 'pt');
    if (p.right) d.push('margin-right:' + pt(p.right) + 'pt');
    if (p.line) {
      if (p.lineRule === 'auto') d.push('line-height:' + r2(p.line / 240));
      else d.push('line-height:' + pt(p.line) + 'pt');
    }
    let indent = 0;
    if (!cont) {
      if (p.firstLine) indent = p.firstLine;
      if (p.hanging) indent = -p.hanging;
    }
    if (indent) d.push('text-indent:' + pt(indent) + 'pt');
    if (p.bg) d.push('background-color:' + p.bg);
    if (p.borders) {
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const b = p.borders[side];
        if (!b) continue;
        const wpt = Math.max(1, b.sz / 8);
        const style = b.style === 'double' ? 'double' : (b.style === 'dashed' ? 'dashed' : (b.style === 'dotted' ? 'dotted' : 'solid'));
        d.push(`border-${side}:${wpt}pt ${style} ${b.color}`);
        if (b.space) d.push(`padding-${side}:${pt(b.space)}pt`);
      }
    }
    // 段落默认字体/字号挂在 p 上，run 只打补丁 → 体积小一半
    d.push('font-family:' + this.fontFamily(this.defaultRunOfPara));
    d.push('font-size:' + r2(this.defaultRunOfPara.size) + 'pt');
    return d.join(';');
  }

  /* ---------------- 段落 ---------------- */

  convertParagraph(pNode, inherited) {
    const pPrNode = el(pNode, 'w:pPr');
    const styleId = wv(el(pPrNode, 'w:pStyle'));
    const chain = styleId ? styleChain(this.styles, styleId) : [];
    const styleIds = chain.map((s) => s.id);

    // 段落属性：docDefaults → 样式链 → 直接格式
    const pd = {};
    readPPr(this.styles.docPPr, pd);
    for (const s of chain) readPPr(s.pPr, pd);
    readPPr(pPrNode, pd);
    if (pd.before === undefined && pd.beforeLines !== undefined) pd.before = pd.beforeLines * 240;
    if (pd.after === undefined && pd.afterLines !== undefined) pd.after = pd.afterLines * 240;
    if (pd.left === undefined && pd.leftChars !== undefined) pd.left = pd.leftChars * 240;
    if (pd.firstLine === undefined && pd.firstLineChars !== undefined) pd.firstLine = pd.firstLineChars * 240;

    // 段落默认 run（用于 p 的 font-family/size、以及 diff 基准）
    const paraRPr = el(pPrNode, 'w:rPr');
    const base = this.resolveRun(styleIds, paraRPr, null);
    this.defaultRunOfPara = base;

    // 走 run
    const rightTab = !!(pd.tabs && pd.tabs.some((t) => t.val === 'right'));
    // pieces：一个 Word 段落可能被页边界切成 2 段。每片各自收集 left/right 两栏。
    const pieces = [];
    let segs = { left: [], right: [], sepBefore: null };
    let side = 'left';
    let pending = { css: null, html: '' };
    const flush = () => {
      if (!pending.html) return;
      segs[side].push(pending.css ? `<span style="${pending.css}">${pending.html}</span>` : pending.html);
      if (pending.css) this.stats.spans++;
      pending = { css: null, html: '' };
    };
    const pushRun = (css, html) => {
      if (!html) return;
      if (pending.css === css) { pending.html += html; return; }
      flush();
      pending = { css, html };
    };
    /** 页边界：先把当前内容落袋，再开新片（新片从左边栏起排） */
    const cutPage = (soft) => {
      flush();
      pieces.push(segs);
      segs = { left: [], right: [], sepBefore: soft ? SOFT_MARK : PAGE_MARK };
      side = 'left';
    };

    const isTabRun = (r) => {
      let hasTab = false;
      let hasText = false;
      for (const k of r.c || []) {
        if (k.n === 'w:tab') hasTab = true;
        else if (k.n === 'w:t') hasText = true;
        else if (k.n === 'w:br' || k.n === 'w:cr' || k.n === 'w:drawing') hasText = true;
      }
      return hasTab && !hasText;
    };

    /** 把 run 按分页标记拆成若干片段：{n:'#pb'} 表示这里翻页，其余是等价的虚拟 run */
    const splitRunByPage = (rNode) => {
      const out = [];
      let cur = null;
      for (const ch of rNode.c || []) {
        if (ch.n === 'w:lastRenderedPageBreak') { out.push({ n: '#pb', soft: true }); cur = null; continue; }
        if (ch.n === 'w:br' && wv(ch) === 'page') { out.push({ n: '#pb', soft: false }); cur = null; continue; }
        if (!cur) { cur = { n: rNode.n, a: rNode.a, c: [] }; out.push(cur); }
        cur.c.push(ch);
      }
      return out;
    };

    const walkInline = (node) => {
      for (const ch of node.c || []) {
        if (ch.n === 'w:r') {
          for (const piece of splitRunByPage(ch)) {
            if (piece.n === '#pb') { cutPage(piece.soft); this.stats.pageBreaks++; continue; }
            // 目录行：tab 之后的页码走右边界（等价 Word 的右制表位）
            if (rightTab && isTabRun(piece)) { flush(); side = 'right'; continue; }
            const rPr = el(piece, 'w:rPr');
            const rStyle = wv(el(rPr, 'w:rStyle'));
            const rChain = rStyle ? styleChain(this.styles, rStyle).map((s) => s.id) : [];
            const eff = this.resolveRun(styleIds.concat(rChain), paraRPr, rPr);
            const css = this.runCss(eff, base);
            const html = this.runContent(piece);
            if (html) { this.stats.runs++; pushRun(css, html); }
          }
        } else if (ch.n === 'w:hyperlink' || ch.n === 'w:smartTag' || ch.n === 'w:ins' || ch.n === 'w:fldSimple') {
          walkInline(ch);
        } else if (ch.n === 'w:del') {
          this.stats.stripped++;   // 修订删除的内容不输出
        }
      }
    };
    walkInline(pNode);
    flush();
    pieces.push(segs);

    // 空段落保留高度（Word 里用来占位）。
    // 目录行的页码：绝对定位到右边界（等价 Word 右制表位），
    // 不用 float —— float 会把页码提到 DOM 最前面，复制/光标顺序会错乱。
    const tag = this.headingTag(styleId);
    const render = (pg, cont) => {
      const rightHtml = pg.right.length
        ? `<span style="position:absolute;right:0;top:0">${pg.right.join('')}</span>`
        : '';
      let inner = pg.left.join('') + rightHtml;
      if (!inner) inner = '<br>';
      let cls = this.paraCss(pd, cont);
      if (rightHtml) cls += ';position:relative;padding-right:3em';
      this.stats.p++;
      return `<${tag} style="${cls}">${inner}</${tag}>`;
    };

    if (pieces.length === 1) return render(pieces[0], false);

    // 多片：空片只在段首/段尾的页边界处出现，丢弃但要把它前面的翻页记号接力下去
    let out = '';
    let emitted = 0;
    let carry = null;
    for (const pg of pieces) {
      if (pg.sepBefore) carry = (carry === PAGE_MARK) ? PAGE_MARK : pg.sepBefore;
      if (!pg.left.length && !pg.right.length) continue;
      if (carry) { out += carry; carry = null; }
      out += render(pg, emitted > 0);
      emitted++;
    }
    // 段末翻页（Word 常把 lastRenderedPageBreak 写在上一段最后一个 run 之后）：
    // 记号必须留在段落外面，否则这一页会凭空消失。
    if (carry) out += carry;
    return out;
  }

  headingTag(styleId) {
    if (!styleId) return 'p';
    const def = this.styles.defs[styleId];
    const name = String((def && def.name) || '').toLowerCase();
    const m = /heading\s*([1-6])/.exec(name) || /标题\s*([1-6])/.exec(name);
    if (m) return 'h' + m[1];
    return 'p';
  }

  /** run 内的文本/换行/图片/制表符 */
  runContent(rNode) {
    let out = '';
    for (const ch of rNode.c || []) {
      switch (ch.n) {
        case 'w:t': out += escText(ch.t || (ch.c || []).map((x) => x.t || '').join('')); break;
        case '#text': break;
        case 'w:tab': out += '<span style="display:inline-block;width:36pt"></span>'; break;
        case 'w:br':
          if (wv(ch) === 'page') { out += ''; this.stats.stripped++; }
          else out += '<br>';
          break;
        case 'w:cr': out += '<br>'; break;
        case 'w:noBreakHyphen': out += '-'; break;
        case 'w:softHyphen': break;
        case 'w:sym': break;
        case 'w:drawing':
        case 'w:pict':
        case 'w:object': out += this.imageOf(ch); break;
        case 'w:instrText':
        case 'w:fldChar': break;      // 域代码指令不展示，只留域结果
        default: break;
      }
    }
    // <w:t> 的文本在上面走 ch.t；但解析器把文本放在 c 里（{n:'#text'}）
    return out;
  }

  imageOf(node) {
    const blip = this.findDeep(node, 'a:blip');
    const rid = blip && (av(blip, 'r:embed') || av(blip, 'r:link'));
    const src = rid && this.media[rid];
    if (!src) return '';
    const ext = this.findDeep(node, 'wp:extent') || this.findDeep(node, 'a:ext');
    let w = ext ? num(av(ext, 'cx')) / EMU_PER_PT : 0;
    let h = ext ? num(av(ext, 'cy')) / EMU_PER_PT : 0;
    // VML（w:pict）用 style="width:..pt;height:..pt"
    if (!w) {
      const shape = this.findDeep(node, 'v:shape');
      const style = shape ? av(shape, 'style') || '' : '';
      const mw = /width:([\d.]+)pt/.exec(style);
      const mh = /height:([\d.]+)pt/.exec(style);
      if (mw) w = Number(mw[1]);
      if (mh) h = Number(mh[1]);
    }
    this.stats.images++;
    const dim = (w && h) ? `width:${r2(w)}pt;height:${r2(h)}pt;` : '';
    return `<img src="${src}" style="${dim}vertical-align:middle">`;
  }

  findDeep(node, name) {
    if (!node) return null;
    if (node.n === name) return node;
    for (const ch of node.c || []) {
      const r = this.findDeep(ch, name);
      if (r) return r;
    }
    return null;
  }

  /* ---------------- 表格 ---------------- */

  convertTable(tblNode) {
    this.stats.tables++;
    const tblPr = el(tblNode, 'w:tblPr');
    const tblStyleId = wv(el(tblPr, 'w:tblStyle'));
    const tblStylePr = tblStyleId && this.styles.defs[tblStyleId] ? this.styles.defs[tblStyleId].tblPr : null;

    const gridCols = els(el(tblNode, 'w:tblGrid'), 'w:gridCol').map((g) => num(av(g, 'w:w')));
    const totalGrid = gridCols.reduce((a, b) => a + b, 0) || 1;

    // 表格级边框（tblStyle → tblBorders）
    const tblBorders = this.readBorders(
      (tblStylePr && el(tblStylePr, 'w:tblBorders')) || el(tblPr, 'w:tblBorders')
    );
    const tblMar = el(tblPr, 'w:tblCellMar');
    const marL = tblMar ? num(av(el(tblMar, 'w:left'), 'w:w'), 108) : 108;
    const marR = tblMar ? num(av(el(tblMar, 'w:right'), 'w:w'), 108) : 108;
    const marT = tblMar ? num(av(el(tblMar, 'w:top'), 'w:w'), 0) : 0;
    const marB = tblMar ? num(av(el(tblMar, 'w:bottom'), 'w:w'), 0) : 0;

    const tW = el(tblPr, 'w:tblW');
    let widthCss = 'width:100%';
    if (tW && av(tW, 'w:type') === 'pct') {
      const p = num(av(tW, 'w:w')) / 50;
      if (p > 0 && p < 100) widthCss = `width:${r2(p)}%`;
    }

    // 行 / 单元格
    const rows = els(tblNode, 'w:tr');
    const grid = [];   // grid[r][c] = {html, attrs} 用于 vMerge
    const outRows = [];
    const pendingMerge = {};   // gridCol -> { rowStart, span }

    rows.forEach((tr, rIdx) => {
      const cells = els(tr, 'w:tc');
      let col = 0;
      const parts = [];
      for (const tc of cells) {
        const tcPr = el(tc, 'w:tcPr');
        const span = num(wv(el(tcPr, 'w:gridSpan')), 1) || 1;
        const tcW = el(tcPr, 'w:tcW');
        let pct = null;
        if (tcW) {
          const type = av(tcW, 'w:type');
          const w = num(av(tcW, 'w:w'));
          if (type === 'dxa' && w > 0) pct = (w / totalGrid) * 100;
          else if (type === 'pct' && w > 0) pct = w / 50;
        }
        if (pct === null) {
          let sum = 0;
          for (let k = 0; k < span; k++) sum += gridCols[col + k] || 0;
          pct = sum ? (sum / totalGrid) * 100 : null;
        }
        const vMergeNode = el(tcPr, 'w:vMerge');
        const vMerge = vMergeNode ? (wv(vMergeNode) || 'continue') : null;

        const b = this.readBorders(el(tcPr, 'w:tcBorders'), tblBorders);
        const style = [];
        if (pct) style.push('width:' + r2(pct) + '%');
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const bd = b[side];
          style.push(`border-${side}:` + (bd ? `${Math.max(1, bd.sz / 8)}pt ${bd.style} ${bd.color}` : 'none'));
        }
        style.push(`padding:${pt(marT)}pt ${pt(marR)}pt ${pt(marB)}pt ${pt(marL)}pt`);
        const shd = el(tcPr, 'w:shd');
        const fill = shd ? normColor(av(shd, 'w:fill')) : null;
        if (fill) style.push('background-color:' + fill);
        const va = wv(el(tcPr, 'w:vAlign'));
        if (va === 'center') style.push('vertical-align:middle');
        else if (va === 'bottom') style.push('vertical-align:bottom');
        else style.push('vertical-align:top');

        const inner = this.convertBlocks(tc, true);

        if (vMerge === 'continue' && pendingMerge[col]) {
          // 继续合并：把这一格的内容并进上面的格子，并加 rowspan
          const holder = pendingMerge[col];
          holder.span++;
          holder.rowspan = holder.span;
          if (inner) holder.extra.push(inner);
          col += span;
          continue;
        }
        const cellHtml = { attrs: style.join(';'), inner, rowspan: 1, colspan: span, span: 1, extra: [] };
        if (vMerge === 'restart') pendingMerge[col] = cellHtml;
        parts.push(cellHtml);
        this.stats.cells++;
        col += span;
      }
      outRows.push({ cells: parts, trPr: el(tr, 'w:trPr'), rIdx });
    });

    // 渲染行（rowspan 在渲染时读取，因为后续行会改它）
    const rowHtmls = outRows.map((row) => {
      const tds = row.cells.map((c) => {
        const rs = c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '';
        const cs = c.colspan > 1 ? ` colspan="${c.colspan}"` : '';
        const extra = c.extra.length ? c.extra.join('') : '';
        return `<td${cs}${rs} style="${c.attrs}">${c.inner}${extra}</td>`;
      }).join('');
      // 行高
      const h = el(row.trPr, 'w:trHeight');
      const hCss = h ? ` style="height:${pt(num(av(h, 'w:val')))}pt"` : '';
      return `<tr${hCss}>${tds}</tr>`;
    });

    const tblStyleArr = [widthCss, 'border-collapse:collapse', 'table-layout:fixed', 'margin:0', 'word-break:break-word'];
    const wrapTable = (rows) => `<table style="${tblStyleArr.join(';')}"><tbody>${rows.join('')}</tbody></table>`;

    // 表格跨页：Word 只会在行边界断开，断点被写在某个单元格的段落里。
    // 这里按行把表拆成多张，页标记挪到两张表之间 —— 比整表挤到下一页更贴近 Word。
    const isMark = (h) => h.indexOf(PAGE_MARK) >= 0 || h.indexOf(SOFT_MARK) >= 0;
    if (!rowHtmls.some(isMark)) return wrapTable(rowHtmls);

    const groups = [];
    const seps = [];
    let cur = [];
    for (const h of rowHtmls) {
      if (isMark(h)) {
        const kind = h.indexOf(PAGE_MARK) >= 0 ? PAGE_MARK : SOFT_MARK;
        const clean = h.split(PAGE_MARK).join('').split(SOFT_MARK).join('');
        if (cur.length) { groups.push(cur); seps.push(kind); cur = []; }
        cur.push(clean);
        continue;
      }
      cur.push(h);
    }
    if (cur.length) groups.push(cur);
    this.stats.tableSplits = groups.length - 1;
    return groups.map((g, i) => (i > 0 ? (seps[i - 1] || PAGE_MARK) : '') + wrapTable(g)).join('');
  }

  /** w:tcBorders / w:tblBorders → {top:{sz,style,color},...}，未定义的一侧返回 undefined */
  readBorders(node, fallback) {
    const out = {};
    for (const side of ['top', 'bottom', 'left', 'right']) {
      let src = node ? el(node, 'w:' + side) : null;
      let b = null;
      if (src) {
        const v = wv(src);
        if (v && v !== 'none' && v !== 'nil') {
          b = { sz: num(av(src, 'w:sz'), 4), style: v === 'double' ? 'double' : (v === 'dashed' ? 'dashed' : (v === 'dotted' ? 'dotted' : 'solid')), color: normColor(av(src, 'w:color')) || '#000000' };
        } else if (v === 'none' || v === 'nil') {
          b = null;
        }
      }
      if (!b && fallback && fallback[side]) b = fallback[side];
      out[side] = b;
    }
    return out;
  }

  /** 块级容器（body / 单元格）里的段落与表格 */
  convertBlocks(node, inCell) {
    const parts = [];
    for (const ch of node.c || []) {
      if (ch.n === 'w:p') {
        // 段前分页：<w:pageBreakBefore/> 或段落里的分节符 <w:sectPr/>（分节 = 强制换页）
        const pPr = el(ch, 'w:pPr');
        const pbb = el(pPr, 'w:pageBreakBefore');
        const sect = el(pPr, 'w:sectPr');
        const forcePage = (pbb && onOff(pbb)) || !!sect;
        const h = this.convertParagraph(ch);
        parts.push((forcePage ? PAGE_MARK : '') + h);
        if (forcePage) this.stats.pageBreaks++;
      }
      else if (ch.n === 'w:tbl') parts.push(this.convertTable(ch));
      else if (ch.n === 'w:sdt') {
        const content = el(ch, 'w:sdtContent');
        if (content) parts.push(this.convertBlocks(content, inCell));
      }
      else if (ch.n === 'w:sectPr' || ch.n === '#text') continue;
    }
    let html = parts.join('');
    if (!html && inCell) html = '<p style="margin:0"><br></p>';
    return html;
  }

  /**
   * 正文 → 按页切开。
   * 切分后校验标签配平：万一页边界落在表格里，片段会不平衡，此时并回上一页，
   * 宁可少一页也不产出坏 HTML（表格内的断点已在 convertTable 里按行拆表处理）。
   */
  convertBody(docNode) {
    const body = el(docNode, 'w:body') || docNode;
    const flat = this.convertBlocks(body, false);
    if (flat.indexOf(PAGE_MARK) < 0 && flat.indexOf(SOFT_MARK) < 0) {
      this.pages = [flat];
      return flat;
    }

    const chunks = [];
    const seps = [];
    let buf = '';
    for (const ch of flat) {
      if (ch === PAGE_MARK || ch === SOFT_MARK) { chunks.push(buf); seps.push(ch); buf = ''; }
      else buf += ch;
    }
    chunks.push(buf);

    const pages = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;                       // 连续断点切出的空壳
      const sep = i > 0 ? seps[i - 1] : null;
      if (!pages.length) { pages.push(chunk); continue; }
      // 软断点 + 整页没有可见内容 → 断点已过期，并回上一页
      if (sep === SOFT_MARK && this.blankPage(chunk)) { pages[pages.length - 1] += chunk; continue; }
      if (this.imbalanced(chunk)) { pages[pages.length - 1] += chunk; continue; }
      pages.push(chunk);
    }
    if (!pages.length) pages.push('');
    this.pages = pages;
    return pages.join(PAGE_MARK);
  }

  /** 整页有没有肉眼可见的内容（只有空段落/空行算空） */
  blankPage(html) {
    if (/<img\b/i.test(html)) return false;
    const t = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/[\s\u0001\u0002]/g, '');
    return t.length === 0;
  }

  /** 标签是否配平（只数 p/table/tr/td/tbody/h1-6/span 这些我们产出的标签） */
  imbalanced(html) {
    const open = {};
    const re = /<(\/?)(p|table|tbody|tr|td|th|span|h[1-6])\b[^>]*?(\/?)>/g;
    let m;
    while ((m = re.exec(html))) {
      const name = m[2];
      if (m[3] === '/') continue;
      open[name] = (open[name] || 0) + (m[1] === '/' ? -1 : 1);
    }
    return Object.keys(open).some((k) => open[k] !== 0);
  }
}

/** 文本转义 + 保留连续空格 */
function escText(s) {
  if (!s) return '';
  let t = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/ {2,}/g, (m) => ' ' + '\u00a0'.repeat(m.length - 1));
  if (/^ /.test(t)) t = '\u00a0' + t.slice(1);
  if (/ $/.test(t)) t = t.slice(0, -1) + '\u00a0';
  return t;
}

/** 页面尺寸/页边距（A4 = 11906×16838 twips，页边距 1134 twips ≈ 20mm） */
function readPageSetup(docNode) {
  const body = el(docNode, 'w:body');
  let sect = body ? el(body, 'w:sectPr') : null;
  if (!sect) {
    // 没有 body 级 sectPr 时，取最后一个段落里的（Word 允许只用分节符定义页面）
    const findLast = (n) => {
      let hit = null;
      const walk = (x) => {
        if (x.n === 'w:sectPr') hit = x;
        for (const c of x.c || []) walk(c);
      };
      walk(n);
      return hit;
    };
    sect = findLast(body || docNode);
  }
  const pgSz = el(sect, 'w:pgSz');
  const pgMar = el(sect, 'w:pgMar');
  const w = num(av(pgSz, 'w:w'), 11906) || 11906;
  const h = num(av(pgSz, 'w:h'), 16838) || 16838;
  const m = (k, dv) => twMm(num(av(pgMar, 'w:' + k), dv));
  const margins = { top: m('top', 1134), right: m('right', 1134), bottom: m('bottom', 1134), left: m('left', 1134) };
  const landscape = String(av(pgSz, 'w:orient') || '') === 'landscape';
  return {
    widthMm: twMm(w),
    heightMm: twMm(h),
    landscape,
    orientation: landscape ? 'landscape' : 'portrait',
    margins,
    headerMm: m('header', 851),
    footerMm: m('footer', 992),
    // 每页可排正文的尺寸（A4 纵向 20mm 边距 → 170×257mm）
    contentWidthMm: Math.round((twMm(w) - margins.left - margins.right) * 100) / 100,
    contentHeightMm: Math.round((twMm(h) - margins.top - margins.bottom) * 100) / 100,
  };
}

/* ------------------------------------------------------------------ 6. 对外入口 */

/**
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer .docx 二进制
 * @returns {Promise<{html:string, pages:string[], pageSetup:object, stats:object, warnings:string[]}>}
 *   html  —— 连续流版本（页边界用 <hr> 表示），用于存库/编辑
 *   pages —— 逐页 HTML，用于按 Word 分页做 A4 纸页呈现
 */
export async function docxToHtml(buffer) {
  const warnings = [];
  const zip = await JSZip.loadAsync(buffer);
  const readText = async (p) => {
    const f = zip.file(p);
    return f ? f.async('string') : null;
  };

  const docXml = await readText('word/document.xml');
  if (!docXml) {
    const e = new Error('不是有效的 .docx（缺少 word/document.xml）');
    e.statusCode = 400;
    throw e;
  }
  const styles = buildStyles(await readText('word/styles.xml'));
  const theme = buildTheme(await readText('word/theme/theme1.xml'));

  // 图片关系：rId -> data URI
  const media = {};
  const relsXml = await readText('word/_rels/document.xml.rels');
  if (relsXml) {
    const rels = parseXml(relsXml);
    const list = (() => {
      const walk = (n) => {
        if (!n || !n.c) return [];
        if (n.n === 'Relationships') return n.c;
        for (const k of n.c) { const r = walk(k); if (r.length) return r; }
        return [];
      };
      return walk(rels);
    })();
    for (const r of list) {
      if (r.n !== 'Relationship') continue;
      const id = av(r, 'Id');
      const target = av(r, 'Target') || '';
      if (!id) continue;
      if (!/image/i.test(av(r, 'Type') || '')) continue;
      const path = 'word/' + target.replace(/^\.\//, '');
      const file = zip.file(path);
      if (!file) { warnings.push('图片缺失：' + path); continue; }
      const ext = (path.match(/\.([a-z0-9]+)$/i) || [, 'png'])[1].toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      const b64 = await file.async('base64');
      media[id] = `data:image/${mime};base64,${b64}`;
    }
  }

  const doc = parseXml(docXml);
  const conv = new Converter({ styles, theme, media });
  const docRoot = el(doc, 'w:document') || doc;
  const flat = conv.convertBody(docRoot);
  const pageSetup = readPageSetup(docRoot);

  const pages = (conv.pages && conv.pages.length) ? conv.pages.slice() : [flat];

  // 用 Word 自己记的页数校准（docProps/app.xml 的 <Pages>，与 lastRenderedPageBreak 同一次保存写入）。
  // 断点快照可能过期，多切出来的纯空白页从后往前并回上一页，直到与 Word 一致。
  const appXml = await readText('docProps/app.xml');
  let wordPages = 0;
  if (appXml) {
    const pm = /<Pages>(\d+)<\/Pages>/.exec(appXml);
    if (pm) wordPages = num(pm[1]);
  }
  let merged = 0;
  if (wordPages) {
    for (let i = pages.length - 1; i > 0 && pages.length > wordPages; i--) {
      if (conv.blankPage(pages[i])) {
        pages[i - 1] += pages[i];
        pages.splice(i, 1);
        merged++;
      }
    }
    if (pages.length !== wordPages) {
      warnings.push(`页数与 Word 记录不一致：切分 ${pages.length} 页 / Word ${wordPages} 页`);
    }
  }

  conv.stats.pages = pages.length;
  conv.stats.wordPages = wordPages;
  conv.stats.mergedBlank = merged;
  // 存库版本：页边界落成真实元素 —— 编辑器里能看到分页线，打印时真的翻页。
  // 用 <hr> 是因为前端 DOMPurify 白名单里有 hr，且允许 style。
  const hr = '<hr style="border:0;border-top:1px dashed #c8cfd8;margin:12px 0;page-break-after:always">';
  const html = pages.join(hr);
  return { html, pages, pageSetup, stats: conv.stats, warnings };
}

/** 供验收脚本用：抽出 HTML 的纯文本（用于和原文档逐字对拍） */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|td|th|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ');
}

/** 供验收脚本用：从 document.xml 抽纯文本（Word 的文本顺序） */
export function docxPlainText(documentXml) {
  const root = parseXml(documentXml);
  const chunks = [];
  const walk = (n) => {
    if (n.n === 'w:t') {
      const t = (n.c || []).map((x) => x.t || '').join('');
      if (t) chunks.push(t);
      return;
    }
    if (n.n === 'w:tab') { chunks.push('\t'); return; }
    if (n.n === 'w:br' || n.n === 'w:cr') { chunks.push('\n'); return; }
    if (n.n === 'w:p') { for (const c of n.c) walk(c); chunks.push('\n'); return; }
    if (n.n === 'w:instrText' || n.n === 'w:del') return;
    for (const c of n.c || []) walk(c);
  };
  walk(root);
  return chunks.join('');
}
