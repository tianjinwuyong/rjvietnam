// 验证 listLots 是否已过滤 wms_closed
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SERVER = 'D:/Program Files/OA/app/server';
const envTxt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[m[1]] === undefined) process.env[m[1]] = v;
}
const { listLots } = await import(pathToFileURL(path.join(SERVER, 'src/services/oa-iqc-service.js')).href);

for (const status of [undefined, 'all', 'pending', 'wms_closed']) {
  const r = await listLots({ status, size: 100 });
  const hit = r.list.some((x) => x.lot_no === 'IQC202610230001');
  console.log(`status=${status ?? '(默认)'} → total=${r.total} 本页${r.list.length}条 含测试行=${hit}`);
}
process.exit(0);
