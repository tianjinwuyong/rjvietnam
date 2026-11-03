import fs from 'node:fs';

const p = 'D:/Program Files/OA/app/web/dist/assets/BasicLayout-BfNiJr1b.js';
const s = fs.readFileSync(p, 'utf8');
const idx = [...s.matchAll(/menu\./g)].map((m) => m.index);
console.log('menu. hits', idx.length);
for (const i of idx.slice(0, 14)) {
  console.log('-----', i);
  console.log(s.slice(Math.max(0, i - 260), i + 200).replace(/\n/g, ' '));
}
