/**
 * 去除 OA「来料检验」列表里的「来料批次（IQC...）」标识列，
 * 统一以「检验编号 JY...」作为界面上的唯一追溯编号（与 WMS 待检页口径一致）。
 *
 * 只改前端 dist 的已编译 chunk（IqcInspect-*.js），不动后端数据：
 *   - iqc_lot_mirror.lot_no 保留（OA 调 WMS claim/result/approve 用的就是它）
 *   - 搜索框仍支持按 IQC 号检索（后端 listLots 的 keyword 覆盖 lot_no）
 *
 * 用法：node tools/patch-iqc-lot-column.mjs          干跑，只打印将要改的片段
 *       node tools/patch-iqc-lot-column.mjs --apply  落盘（自动备份）
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'D:/Program Files/OA/app/web/dist/assets';
const FILE = path.join(DIST, 'IqcInspect-Dct8UQzP.js');
const APPLY = process.argv.includes('--apply');

const src = fs.readFileSync(FILE, 'utf8');

/** 从 openIdx（指向 '(' 或 '{' 或 '['）找到配对闭合位置，返回闭合字符下标 */
function matchClose(str, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('括号未闭合 @' + openIdx);
}

/** 向前找到最近的 '_(', '_(V,', '_(y,' 这类组件调用起点 */
function findCallStart(str, idx) {
  for (let i = idx; i >= 0; i--) {
    if (str[i] === '(' && str[i - 1] === '_') return i - 1;
  }
  throw new Error('未找到组件调用起点 @' + idx);
}

const marks = [];
let p = -1;
while ((p = src.indexOf('来料批次', p + 1)) >= 0) marks.push(p);
if (marks.length !== 3) throw new Error(`预期 3 处「来料批次」，实际 ${marks.length}`);

const edits = [];

/* ① 详情卡片字段：{label:n("来料批次",...),value:$(t.lot_no,l.lot_no)}, —— 整条删除 */
{
  const open = src.lastIndexOf('{', marks[0]);
  const close = matchClose(src, open);
  let end = close + 1;
  if (src[end] === ',') end++;
  edits.push({ start: open, end, kind: '删除详情卡片「来料批次」字段' });
}

/* ② 列表首列：标签改为「检验编号」，取值改成 inspection_no（库位第二行保持不变） */
{
  const start = findCallStart(src, marks[1]);
  const close = matchClose(src, start);
  const before = src.slice(start, close + 1);
  const after = before
    .replace('n("来料批次","Lô IQC","IQC lot")', 'n("检验编号","Số phiếu","Inspection no.")')
    .replace('s.lot_no', 's.inspection_no');
  if (after === before) throw new Error('列表首列未发生替换');
  edits.push({ start, end: close + 1, kind: '列表首列 → 检验编号(JY)', text: after });
}

/* ③ 列表里原有的「检验编号」列（width:112）—— 已成重复列，整列删除 */
{
  let idx = -1;
  let from = 0;
  while (true) {
    const w = src.indexOf('width:"112"', from);
    if (w < 0) break;
    if (src.slice(w - 160, w).includes('检验编号')) { idx = w; break; }
    from = w + 1;
  }
  if (idx < 0) throw new Error('未找到重复的检验编号列');
  const start = findCallStart(src, idx);
  const close = matchClose(src, start);
  let end = close + 1;
  if (src[end] === ',') end++;
  edits.push({ start, end, kind: '删除重复的「检验编号」列' });
}

/* ④ 详情表单「来料批次」项 —— 整项删除 */
{
  const start = findCallStart(src, marks[2]);
  const close = matchClose(src, start);
  let end = close + 1;
  if (src[end] === ',') end++;
  edits.push({ start, end, kind: '删除详情表单「来料批次」项' });
}

edits.sort((a, b) => b.start - a.start);

for (const e of edits) {
  const oldText = src.slice(e.start, e.end);
  console.log(`\n=== ${e.kind} ===`);
  console.log('原片段：', oldText.length > 400 ? oldText.slice(0, 400) + '…' : oldText);
  if (e.text) console.log('改为：  ', e.text.length > 400 ? e.text.slice(0, 400) + '…' : e.text);
}

let out = src;
for (const e of edits) {
  out = out.slice(0, e.start) + (e.text ?? '') + out.slice(e.end);
}

// 复查：不应再有「来料批次」；「检验编号」在列表里只应剩首列那一处（+ 详情卡片 + 表单）
const leftLot = (out.match(/来料批次/g) || []).length;
const leftInsp = (out.match(/检验编号/g) || []).length;
console.log(`\n剩余「来料批次」：${leftLot} 处；「检验编号」：${leftInsp} 处`);
if (leftLot !== 0) throw new Error('仍残留「来料批次」');

if (!APPLY) {
  console.log(`\n[干跑] 文件长度 ${src.length} → ${out.length}，加 --apply 落盘`);
  process.exit(0);
}

const bak = `${FILE}.bak-iqclot-20261025`;
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
fs.writeFileSync(FILE, out, 'utf8');
console.log(`\n已写入 ${FILE}\n备份 ${bak}`);
