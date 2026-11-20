import fs from 'node:fs';

const p = 'D:/Program Files/OA/app/web/dist/assets/index-Rjm2WAZr.js';
const s = fs.readFileSync(p, 'utf8');
console.log('len', s.length);

const titles = [...s.matchAll(/title:\s*["'`]([^"'`]{1,24})["'`]/g)].map((m) => m[1]);
console.log('titles', titles.length);
console.log([...new Set(titles)].join(' | '));

// 找 path 定义
const paths = [...s.matchAll(/path:\s*["'`](\/[a-zA-Z0-9_\-\/:]*)["'`]/g)].map((m) => m[1]);
console.log('paths', paths.length);
console.log([...new Set(paths)].join(' '));
