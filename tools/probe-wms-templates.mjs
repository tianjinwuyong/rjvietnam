// 只读探测：WMS 的 IQC 模板库规模，判断接管前是否需要搬迁模板
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
const login = await fetch(`${base}/api/system/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: cfg.username, password: cfg.password }),
  signal: AbortSignal.timeout(15000),
});
const token = (await login.json())?.data?.token;
const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

const r = await fetch(`${base}/api/iqc/templates?page=1&pageSize=5`, { headers: h, signal: AbortSignal.timeout(20000) });
const j = await r.json();
const d = j?.data;
const items = Array.isArray(d?.items) ? d.items : (Array.isArray(d) ? d : []);
console.log(`模板接口 HTTP ${r.status}  total=${d?.total ?? '?'}  返回 ${items.length} 条`);
if (items[0]) {
  console.log('字段：' + Object.keys(items[0]).join(','));
  for (const t of items.slice(0, 5)) {
    console.log(`  · ${t.templateCode || t.code} | ${t.templateName || t.name} | 项目数=${t.itemCount ?? t.items?.length ?? '?'} | 状态=${t.status ?? '?'}`);
  }
}

// 取一个模板的项目明细，看搬迁难度
const first = items[0];
if (first?.id) {
  const r2 = await fetch(`${base}/api/iqc/templates/${first.id}`, { headers: h, signal: AbortSignal.timeout(20000) });
  const j2 = await r2.json();
  const d2 = j2?.data;
  const arr = d2?.items || d2?.templateItems || (Array.isArray(d2) ? d2 : []);
  console.log(`\n模板 ${first.templateCode || first.id} 项目明细：${Array.isArray(arr) ? arr.length : 0} 条`);
  if (Array.isArray(arr) && arr[0]) console.log('项目字段：' + Object.keys(arr[0]).join(','));
  for (const it of (Array.isArray(arr) ? arr : []).slice(0, 6)) {
    console.log(`  - [${it.sectionType || it.section || '?'}] ${it.itemName || it.name} 规格=${it.spec || '-'} 单位=${it.unit || '-'}`);
  }
}
