// 验证 wms-iqc-pull：真跑一轮，看插入/更新条数与字段质量
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
const imp = (p) => import(pathToFileURL(path.join(SERVER, p)).href);
const { pullPendingLots } = await imp('src/services/wms-iqc-pull.js');
const { query } = await imp('src/db/index.js');

const t0 = Date.now();
const r = await pullPendingLots({ actor: 'probe' });
console.log(`\n耗时 ${Date.now() - t0}ms`);
console.log(JSON.stringify(r, null, 2));

const stat = await query(`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status='pending')::int AS pending,
         count(*) FILTER (WHERE template_id IS NOT NULL)::int AS tpl,
         count(*) FILTER (WHERE sampling->>'strictness'='normal')::int AS normal,
         count(*) FILTER (WHERE wms_status='rejected')::int AS rejected
    FROM iqc_lot_mirror`);
console.log('\n库内现状：', stat.rows[0]);

const sample = await query(`
  SELECT lot_no, inspection_no, receipt_date, material_code, material_name,
         supplier_name, qty, unit, batch_no, locations, status, wms_status,
         sampling->>'strictness' AS strict
    FROM iqc_lot_mirror ORDER BY receipt_date DESC, id DESC LIMIT 5`);
console.table(sample.rows);

process.exit(0);
