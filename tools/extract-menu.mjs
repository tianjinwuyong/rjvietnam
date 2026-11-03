import fs from 'node:fs';
import path from 'node:path';

const dir = 'D:/Program Files/OA/app/web/dist/assets';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const hits = [];
for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  if (s.includes('menu.docSystem') || s.includes('menu.sysMgr')) hits.push([f, s.length]);
}
console.log('files containing menu keys:', hits);

// 提取 ae 数组
const s = fs.readFileSync(path.join(dir, 'BasicLayout-BfNiJr1b.js'), 'utf8');
const start = s.indexOf('const ae=[');
if (start < 0) throw new Error('not found');
let i = s.indexOf('[', start);
let depth = 0;
let end = -1;
for (let k = i; k < s.length; k++) {
  const c = s[k];
  if (c === '[' || c === '{') depth++;
  else if (c === ']' || c === '}') {
    depth--;
    if (depth === 0 && c === ']') { end = k + 1; break; }
  }
}
const lit = s.slice(i, end);
const arr = eval(lit);
fs.writeFileSync('C:/Users/Bruce/WorkBuddy/2026-10-24-23-29-25/tools/menu.json', JSON.stringify(arr, null, 2));
console.log('groups', arr.length);
for (const g of arr) console.log(g.group, g.icon, g.single || '', '->', (g.items || []).map((x) => x.title).join(','));
