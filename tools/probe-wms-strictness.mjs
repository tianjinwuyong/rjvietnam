// 只读探测 2：严格度 / 抽样参数 / 单批次详情，判断「主动拉」能否凑齐 OA 需要的最小字段
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
const { getSystemConfig } = await imp('src/services/integration-config.js');

const cfg = await getSystemConfig('WMS');
const base = String(cfg.baseUrl).replace(/\/+$/, '');
const res = await fetch(`${base}/api/system/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: cfg.username, password: cfg.password }),
  signal: AbortSignal.timeout(15000),
});
const token = (await res.json())?.data?.token;
const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

async function probe(label, url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* noop */ }
    console.log(`\n[${label}] HTTP ${r.status} ${Date.now() - t0}ms`);
    if (!r.ok) { console.log('  ' + txt.slice(0, 300)); return; }
    const s = JSON.stringify(j);
    console.log('  ' + (s.length > 900 ? s.slice(0, 900) + ' …' : s));
  } catch (e) {
    console.log(`\n[${label}] 失败 ${e.message}`);
  }
}

// 先取一条真实待检批次，拿它的 materialId / id 去探详情与严格度
const pr = await fetch(`${base}/api/iqc/pending?page=1&pageSize=1&statuses=pending`, { headers: h });
const first = (await pr.json())?.data?.items?.[0] || {};
console.log(`\n样本批次 ${first.lotNo} materialId=${first.materialId} id=${first.id}`);

await probe('严格度 current', `${base}/api/iqc/strictness/current?materialId=${first.materialId}`);
await probe('单个批次详情', `${base}/api/iqc/lot/${first.id}`);
await probe('报检项（抽样依据）', `${base}/api/iqc/inspection-items/${first.materialId}`);
await probe('参数 iqc_pending_warning_hours', `${base}/api/system/param/iqc_pending_warning_hours`);
await probe('参数 iqc_pending_urgent_hours', `${base}/api/system/param/iqc_pending_urgent_hours`);
