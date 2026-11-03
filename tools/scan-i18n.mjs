import fs from 'node:fs';

const p = 'D:/Program Files/OA/app/web/dist/assets/index-Rjm2WAZr.js';
const s = fs.readFileSync(p, 'utf8');

for (const needle of ['menu:{home', 'menu.workbench', 'iqcGroup']) {
  const i = s.indexOf(needle);
  console.log('=== needle', needle, 'at', i);
  if (i > -1) console.log(s.slice(Math.max(0, i - 200), i + 1200));
  console.log();
}
