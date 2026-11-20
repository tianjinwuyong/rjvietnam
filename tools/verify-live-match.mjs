// 独立比对：OA 的看板接口 vs 直连 WMS 的同一接口。
// 目的：证明 OA 显示的数字与 WMS 自己算的**逐字段一致**，不是 OA 另算一套。
// 不打印任何密码。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SERVER = 'D:/Program Files/OA/app/server';
const OA = 'http://127.0.0.1:8080';
const OA_KEY = 'wms_a59d88420734ab27166de208b10fa91e';

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
if (!cfg?.username || !cfg?.password) {
  console.log('WMS 账号未配置，无法比对');
  process.exit(1);
}
const base = String(cfg.baseUrl).replace(/\/+$/, '');

// 1) 直连 WMS 登录
const lr = await fetch(`${base}/api/system/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: cfg.username, password: cfg.password }),
});
const lj = await lr.json();
const wmsToken = lj?.data?.token || lj?.token;
if (!wmsToken) {
  console.log('WMS 登录失败：', lj?.error?.message || lj?.message);
  process.exit(1);
}
console.log(`WMS 直连登录成功（账号 ${cfg.username}）`);

// 2) 同一区间同一粒度
const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
const qs = new URLSearchParams({ startDate: start, endDate: end, granularity: 'day' }).toString();

const wmsGet = async (p) => {
  const r = await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}${qs}`, {
    headers: { Authorization: `Bearer ${wmsToken}` },
  });
  const j = await r.json();
  return j?.data !== undefined && j?.code !== undefined ? j.data : j;
};
const oaGet = async (p) => {
  const r = await fetch(`${OA}${p}`, { headers: { 'x-api-key': OA_KEY } });
  const j = await r.json();
  return j.data;
};

const [wmsStats, oaDash] = await Promise.all([
  wmsGet('/api/dashboard/iqc-stats'),
  oaGet('/api/quality/wms-iqc/dashboard'),
]);

const cmp = (label, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? 'SAME' : 'DIFF'}  ${label}: WMS=${JSON.stringify(a)}  OA=${JSON.stringify(b)}`);
  return ok;
};

console.log(`\n区间 ${start} ~ ${end}（双方同参数）\n`);
let allOk = true;
allOk &= cmp('totalLots', wmsStats.summary.totalLots, oaDash.summary.totalLots);
allOk &= cmp('passedLots', wmsStats.summary.passedLots, oaDash.summary.passedLots);
allOk &= cmp('failedLots', wmsStats.summary.failedLots, oaDash.summary.failedLots);
allOk &= cmp('passRate', wmsStats.summary.passRate, oaDash.summary.passRate);
allOk &= cmp('targetPassRate', wmsStats.summary.targetPassRate, oaDash.summary.targetPassRate);
allOk &= cmp('趋势点数', wmsStats.trend.length, oaDash.trend.length);

const wTrend = wmsStats.trend.map(t => `${t.date}|${t.totalLots}|${t.passedLots}|${t.passRate}`);
const oTrend = oaDash.trend.map(t => `${t.bucket}|${t.total}|${t.passed}|${t.passRate}`);
allOk &= cmp('趋势逐点', wTrend, oTrend);

// 3) 不良分布单独比对
const [wType, oaType] = await Promise.all([
  wmsGet('/api/dashboard/iqc-defect-by-type'),
  oaGet('/api/quality/wms-iqc/dashboard'),
]);
allOk &= cmp('不良类型分布', wType, oaType.defectByType);

// 4) 待检/超期
const [wOvd, wPend] = await Promise.all([
  wmsGet('/api/dashboard/iqc-overdue'), wmsGet('/api/dashboard/pending-stats'),
]);
allOk &= cmp('pending', wPend.pendingCount, oaDash.summary.pending);
allOk &= cmp('warning', wOvd.warningCount, oaDash.summary.warning);
allOk &= cmp('overdue', wOvd.overdueCount, oaDash.summary.overdue);

// 5) 证明是实时：两次抓取的时刻不同
const a1 = await oaGet('/api/quality/wms-iqc/dashboard');
await new Promise(r => setTimeout(r, 1200));
const a2 = await oaGet('/api/quality/wms-iqc/dashboard');
const liveOk = a1.fetchedAt !== a2.fetchedAt;
console.log(`${liveOk ? 'SAME' : 'DIFF'}  两次抓取时刻不同（证明每次真去问 WMS）: ${a1.fetchedAt} vs ${a2.fetchedAt}`);

console.log(`\n结论：${allOk ? 'OA 与 WMS 数字完全一致' : '存在差异，需要排查'}；实时性 ${liveOk ? '正常' : '异常'}`);
process.exit(allOk && liveOk ? 0 : 1);
