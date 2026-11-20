// 验证 wms-iqc-live 的实时通道：连接 → 登录 → token → 错误处理。
// 用临时占位账号跑一遍，只为确认链路可达、失败时能给出可读原因；不涉及真实凭据。
// 跑完自动把临时账号清空。
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
const { saveSystemConfig, getSystemConfig, encryptSecret } = await imp('src/services/integration-config.js');
const { getWmsLiveStatus, getIqcDashboardLive, resetWmsToken } = await imp('src/services/wms-iqc-live.js');
const { query } = await imp('src/db/index.js');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ── 0. 未配置账号时应明确返回「未配置」，而不是假装成功 ──
let st = await getWmsLiveStatus();
check('未配置账号 → configured=false', st.configured === false, st.message);

// ── 1. 写入临时占位账号 ──
await saveSystemConfig('WMS', { username: '__probe__', password: '__probe__' });
resetWmsToken();
const cfg = await getSystemConfig('WMS');
check('账号已加密存储并可用', cfg.username === '__probe__' && cfg.password === '__probe__',
  `user=${cfg.username} pwd_len=${(cfg.password || '').length}`);

// ── 2. 用错误账号登录：必须失败，且错误信息可读（证明真的连到 WMS 了） ──
st = await getWmsLiveStatus();
check('错误账号 → 登录失败且原因可读',
  st.configured === true && st.ok === false && /登录失败/.test(st.message || ''),
  st.message);

// ── 3. 看板调用必须抛错，而不是返回 0 条假数据 ──
let threw = null;
try {
  await getIqcDashboardLive({});
} catch (e) {
  threw = e;
}
check('登录失败时看板抛错（不伪造数据）',
  !!threw && threw.code === 'WMS_LOGIN_FAILED',
  threw ? `${threw.code}: ${threw.message}` : '没有抛错');

// ── 4. 上层服务应降级为 wmsAvailable=false，并带上原因 ──
const svc = await imp('src/services/wms-iqc-service.js');
const dash = await svc.getIqcDashboard({});
check('上层降级为 wmsAvailable=false 且带 error',
  dash.wmsAvailable === false && !!dash.error && dash.source === 'wms-http',
  `${dash.source} / ${dash.error}`);

// ── 5. 清理临时账号 ──
await query(`UPDATE sys_integration_system SET username=NULL, password_enc=NULL WHERE system_code='WMS'`);
resetWmsToken();
// 注意：getSystemConfig 有 60s 内存缓存，这里直接查库确认真正落盘的状态
const rows = await query(
  `SELECT username, password_enc FROM sys_integration_system WHERE system_code='WMS'`
);
const r0 = rows.rows[0] || {};
check('临时账号已清理', !r0.username && !r0.password_enc,
  `db: username=${r0.username || 'null'} password_enc=${r0.password_enc ? '有值' : 'null'}`);

const pass = results.filter(r => r.pass).length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);
