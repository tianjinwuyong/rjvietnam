// ============================================================
// xlsx-dv —— 给生成的 .xlsx 注入「数据有效性（下拉选）」
// ------------------------------------------------------------
// 为什么不能直接用 SheetJS 写：
//   服务端用的是 xlsx@0.20.3 社区版（package.json 里装的是 cdn.sheetjs.com 的 tgz）。
//   社区版**只解析不写** dataValidation —— xlsx.mjs 里三处 dataValidation 全在
//   parse 分支（`case 'datavalidation':` 直接跳过），没有对应的 write 逻辑。
//   所以下拉选只能在 SheetJS 产出 zip 之后，自己改 xl/worksheets/sheetN.xml 再打回去。
//   jszip 本来就是服务端依赖（docx 导入在用），不引入新包。
//
// 关键约束（踩过就别再踩）：
//   1) OOXML 的 CT_Worksheet 是**有序**序列：dataValidations 必须排在
//      mergeCells / conditionalFormatting **之后**，hyperlinks / pageMargins / drawing **之前**。
//      直接插在 </worksheet> 前面是错的（会跑到 pageMargins 后面），Excel 可能提示修复。
//   2) 下拉列表框的开关是 showDropDown，但语义反着来：`showDropDown="1"` = **隐藏**箭头。
//      要显示箭头就**不要写这个属性**（或写 0）。
//   3) 内联清单 formula1 必须整条被双引号包住：<formula1>"day,night"</formula1>；
//      而且 Excel 有 255 字符上限，超了会静默失效 → 这里显式拒绝并降级为「只给输入提示」。
// ============================================================
import XLSX from 'xlsx';
import JSZip from 'jszip';

/** 内联列表的硬上限（Excel 的 255 字符限制，留 5 字符余量给引号与转义） */
export const INLINE_LIST_MAX = 250;

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 元素**文本**里的转义：不转义双引号。
 * 内联清单要写成 <formula1>"day,night"</formula1>（Excel 自己就是这么写的），
 * 转成 &quot; 虽然解码后等价，但没必要跟 Excel 的原样输出不一致。
 */
function xmlText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** workbook.xml 的 sheet name → 关系 id（属性顺序不固定，逐属性抓） */
function sheetRelIds(workbookXml) {
  const map = new Map();
  const re = /<sheet\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(workbookXml))) {
    const attrs = m[1];
    const name = /\bname="([^"]*)"/.exec(attrs);
    const rid = /\br:id="([^"]*)"/.exec(attrs) || /\bid="(rId[^"]*)"/.exec(attrs);
    if (name && rid) map.set(decodeXml(name[1]), rid[1]);
  }
  return map;
}

/** 关系 id → 实际 xml 路径 */
function relTargets(relsXml) {
  const map = new Map();
  const re = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(relsXml))) {
    const attrs = m[1];
    const id = /\bId="([^"]*)"/.exec(attrs);
    const target = /\bTarget="([^"]*)"/.exec(attrs);
    if (!id || !target) continue;
    let t = target[1];
    if (t.startsWith('/')) t = t.slice(1);
    else if (!t.startsWith('xl/')) t = `xl/${t}`;
    map.set(id[1], t.replace(/^\.\//, ''));
  }
  return map;
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** dataValidations 之后才允许出现的元素（取最早出现者作为插入点） */
const AFTER_MARKERS = [
  '<hyperlinks', '<printOptions', '<pageMargins', '<pageSetup', '<headerFooter',
  '<rowBreaks', '<colBreaks', '<drawing', '<legacyDrawing', '<legacyDrawingHF',
  '<tableParts', '<extLst',
];

/**
 * 把一段 xml 插到「dataValidations 该在的位置」。
 * 找不到任何后继元素时落到 </worksheet> 之前。
 */
export function insertValidationBlock(sheetXml, block) {
  let at = -1;
  for (const marker of AFTER_MARKERS) {
    const i = sheetXml.indexOf(marker);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = sheetXml.lastIndexOf('</worksheet>');
  if (at < 0) throw new Error('sheet xml 里找不到 </worksheet>，文件结构异常');
  return sheetXml.slice(0, at) + block + sheetXml.slice(at);
}

function renderOneRule(r) {
  const type = r.type || 'list';
  const attrs = [
    `type="${xmlEsc(type)}"`,
    // allowBlank 默认开：下拉只是「少打字」，不该把「这行不填」变成错误
    `allowBlank="${r.allowBlank === false ? 0 : 1}"`,
    `showInputMessage="${r.prompt ? 1 : 0}"`,
    `showErrorMessage="${r.error ? 1 : 0}"`,
  ];
  // 注意：showDropDown="1" 是**隐藏**箭头，默认要箭头就显式写 0（且只能出现一次，否则是非法 xml）
  attrs.push(`showDropDown="${r.hideDropdown ? 1 : 0}"`);
  if (r.operator && type !== 'list') attrs.push(`operator="${xmlEsc(r.operator)}"`);
  if (r.error) attrs.push(`errorStyle="${xmlEsc(r.errorStyle || 'stop')}"`);
  if (r.promptTitle) attrs.push(`promptTitle="${xmlEsc(r.promptTitle)}"`);
  if (r.prompt) attrs.push(`prompt="${xmlEsc(r.prompt)}"`);
  if (r.error) attrs.push(`errorTitle="${xmlEsc(r.errorTitle || r.promptTitle || '')}"`);
  if (r.error) attrs.push(`error="${xmlEsc(r.error)}"`);
  attrs.push(`sqref="${xmlEsc(r.ref)}"`);

  const formula = type === 'list'
    ? `"${String(r.formula1).replace(/"/g, '""')}"`
    : String(r.formula1);

  const f2 = r.formula2 != null ? `<formula2>${xmlText(r.formula2)}</formula2>` : '';
  return `<dataValidation ${attrs.join(' ')}><formula1>${xmlText(formula)}</formula1>${f2}</dataValidation>`;
}

/**
 * 注入数据有效性。
 * @param {Buffer} buffer SheetJS 产出的 xlsx
 * @param {Record<string, Array<object>>} rulesBySheet 表名 → 规则数组
 *        规则：{ ref:'D2:D2000', type?:'list'|'whole', list?:string[], formula1?:string,
 *                promptTitle?, prompt?, error?, errorStyle?:'stop'|'warning'|'information',
 *                hideDropdown?:boolean, allowBlank?:boolean }
 * @returns {Promise<Buffer>}
 */
export async function injectDataValidations(buffer, rulesBySheet) {
  const wanted = Object.entries(rulesBySheet || {}).filter(([, rules]) => Array.isArray(rules) && rules.length);
  if (!wanted.length) return buffer;

  const zip = await JSZip.loadAsync(buffer);
  const wbFile = zip.file('xl/workbook.xml');
  const relFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!wbFile || !relFile) throw new Error('xlsx 缺少 workbook.xml / rels，无法注入下拉选');

  const relIds = sheetRelIds(await wbFile.async('string'));
  const targets = relTargets(await relFile.async('string'));

  const applied = [];
  for (const [sheetName, rules] of wanted) {
    const rid = relIds.get(sheetName);
    const path = rid ? targets.get(rid) : null;
    if (!path) { applied.push({ sheet: sheetName, path: null, count: 0 }); continue; }

    const file = zip.file(path);
    if (!file) { applied.push({ sheet: sheetName, path, count: 0 }); continue; }

    let xml = await file.async('string');
    if (/<dataValidations\b/.test(xml)) { applied.push({ sheet: sheetName, path, count: 0 }); continue; }

    const list = rules.map(r => {
      if (r.type === 'list' || !r.type) {
        const joined = (r.list || []).join(',');
        if (joined.length > INLINE_LIST_MAX) {
          throw new Error(`下拉清单过长（${joined.length} 字符 > ${INLINE_LIST_MAX}）：${sheetName} ${r.ref}`);
        }
        return { ...r, type: 'list', formula1: joined };
      }
      return r;
    });

    const block = `<dataValidations count="${list.length}">${list.map(renderOneRule).join('')}</dataValidations>`;
    xml = insertValidationBlock(xml, block);
    zip.file(path, xml);
    applied.push({ sheet: sheetName, path, count: list.length });
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** 整数字段校验（周期天数 / 间隔），软提示，不拦人 */
export function wholeNumberRule(ref, { min = 0, max = 9999, ...rest } = {}) {
  return {
    ref, type: 'whole', formula1: String(min), formula2: String(max),
    errorStyle: 'warning', ...rest,
  };
}

/** 清单规则（下拉选） */
export function listRule(ref, list, { errorStyle = 'stop', ...rest } = {}) {
  return { ref, type: 'list', list, errorStyle, ...rest };
}
