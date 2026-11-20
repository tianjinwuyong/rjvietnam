import fs from 'node:fs';

const files = [
  'D:/Program Files/OA/app/web/dist/integration-setup.html',
  'D:/Program Files/OA/app/web/dist/integration-console.html',
  'D:/Program Files/OA/app/web/dist/oa-shell.js'
];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.js')) {
    try { new Function(src); console.log('OK   ', f); }
    catch (e) { console.log('FAIL ', f, '->', e.message); }
    continue;
  }
  const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  let bad = 0;
  blocks.forEach((code, i) => {
    try { new Function(code); }
    catch (e) { bad++; console.log('FAIL ', f, 'script#' + i, '->', e.message); }
  });
  console.log(bad ? 'FAIL ' : 'OK   ', f, '(' + blocks.length + ' inline scripts)');
}
