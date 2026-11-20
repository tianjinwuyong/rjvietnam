// 只读探测：用当前配置的 WMS 账号，试调 /api/iqc/pending（待检批次明细）
// 目的：确认 OA 能否「主动拉」待检清单，字段是否够用。不写任何数据。
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
if (!cfg?.baseUrl || !cfg?.username || !cfg?.password) {
  console.log('未配置 WMS 账号，无法探测');
  process.exit(1);
}
const base = String(cfg.baseUrl).replace(/\/+$/, '');

const res = await fetch(`${base}/api/system/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: cfg.username, password: cfg.password }),
  signal: AbortSignal.timeout(15000),
});
const lj = await res.json().catch(() => null);
const token = lj?.data?.token || lj?.token;
console.log(`登录 ${res.status} → token ${token ? 'OK(len=' + token.length + ')' : '缺失'}`);
if (!token) process.exit(1);

const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

async function probe(label, url) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { /* noop */ }
  const d = j?.data;
  const items = Array.isArray(d?.items) ? d.items : (Array.isArray(d) ? d : []);
  console.log(`\n[${label}] HTTP ${r.status} ${Date.now() - t0}ms`);
  if (!r.ok) { console.log('  错误：' + txt.slice(0, 200)); return; }
  console.log(`  total=${d?.total ?? '?'} items=${items.length} keys=${items[0] ? Object.keys(items[0]).join(',') : '(空)'}`);
  for (const it of items.slice(0, 3)) {
    console.log(`  · ${it.lotNo || it.batchNo} | ${it.materialCode} ${it.materialName} | ${it.supplierName} | qty=${it.totalQty} | status=${it.status} | 报检=${it.submittedAt || '-'} | 入库=${it.receiptDate || '-'}`);
  }
}

// 1) 待检清单（WMS 待检页同款）：只取待检验 + 被驳回
await probe('待检清单 statuses=pending,rejected',
  `${base}/api/iqc/pending?page=1&pageSize=5&statuses=${encodeURIComponent('pending,rejected')}`);
// 2) 不带状态，看全量
await probe('待检清单 全状态',
  `${base}/api/iqc/pending?page=1&pageSize=5`);
// 3) 待检统计（只有数量，用于对比）
await probe('pending-stats 统计',
  `${base}/api/dashboard/pending-stats`);
