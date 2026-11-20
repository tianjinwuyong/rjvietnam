// WMS ↔ OA 端到端验证（临时实例 3999，CRON 关闭，不会真实投递回调）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SERVER = 'D:/Program Files/OA/app/server';
const req = createRequire(path.join(SERVER, 'package.json'));
const { Client } = req('pg');

const B = 'http://127.0.0.1:3999';
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
}

const txt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8');
const env = {};
for (const l of txt.split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

async function j(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
}

const db = new Client({
  host: env.DB_HOST || 'localhost', port: +(env.DB_PORT || 5432),
  database: env.DB_NAME || 'oa_system', user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD || '',
});

(async () => {
  await db.connect();
  // 清理本测试以往留下的密钥，保证「无重复」断言可复现
  await db.query(`DELETE FROM sys_api_key WHERE name LIKE 'WMS 对接%'`);

  // 1. 管理员登录
  const login = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const lj = await j(login);
  const token = lj?.data?.token;
  ok('管理员登录', !!token);
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 2. 服务账号（幂等）
  let svcRow = (await db.query(`SELECT id, username, real_name FROM org_user WHERE username='wms_bot'`)).rows[0];
  if (!svcRow) {
    const r = await fetch(B + '/api/integration/service-accounts', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ username: 'wms_bot', realName: 'WMS 系统' }),
    });
    const rj = await j(r);
    ok('创建服务账号 wms_bot', r.status === 200 && rj?.data?.id > 0, JSON.stringify(rj.data || rj.msg));
    svcRow = rj?.data;
  } else {
    ok('服务账号 wms_bot 已存在', true, '#' + svcRow.id);
  }
  const svcId = Number(svcRow.id);
  ok('服务账号为非管理员', svcId > 1, 'id=' + svcId);

  // 3. 候选账号接口
  const sa = await j(await fetch(B + '/api/integration/service-accounts', { headers: auth }));
  ok('服务账号列表可用', Array.isArray(sa.data) && sa.data.some(x => Number(x.id) === svcId), '共 ' + (sa.data?.length || 0) + ' 个');

  // 4. 生成 API Key（绑定 wms_bot）
  const ck = await j(await fetch(B + '/api/integration/keys', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'WMS 对接', permissions: ['flow:submit'], serviceUserId: svcId, description: 'WMS→OA 提交单据' }),
  }));
  const plainKey = ck?.data?.key;
  const keyId = ck?.data?.id;
  ok('生成 API Key', !!plainKey && plainKey.startsWith('oa_'), 'ID=' + keyId);

  // 5. 登记已有密钥（幂等：同一把 Key 不应重复插入）
  const imp = await j(await fetch(B + '/api/integration/keys/import', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ key: plainKey, name: 'WMS 对接（导入校验）', permissions: ['flow:submit'], serviceUserId: svcId }),
  }));
  ok('登记已有密钥（幂等命中同一条）', imp?.data?.id === keyId, JSON.stringify({ id: imp?.data?.id, msg: imp.msg }));
  const keyCount = (await db.query(`SELECT count(*)::int n FROM sys_api_key`)).rows[0].n;
  ok('密钥表无重复记录', keyCount === 1, '共 ' + keyCount + ' 条');

  // 6. 无密钥应被拒
  const noKey = await fetch(B + '/api/instances', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitionId: 35, title: 'test' }),
  });
  ok('无密钥提交被拒', noKey.status === 401, 'HTTP ' + noKey.status);

  // 7. 用 API Key 提交单据（模拟 WMS 领料）
  const bizKey = 'TEST-' + Date.now();
  const sub = await fetch(B + '/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': plainKey },
    body: JSON.stringify({
      definitionId: 35,
      title: 'WMS 领料申请 ' + bizKey,
      applicantUserId: 1,
      bizSystem: 'WMS', bizType: 'picking_flow', bizKey,
      submitNow: true,
      formData: { picking_no: bizKey, material_code: 'M-TEST-001', qty: 12, warehouse: 'A01' },
    }),
  });
  const sj = await j(sub);
  const instId = sj?.data?.id;
  ok('API Key 提交单据成功', sub.status === 200 && !!instId, 'instanceId=' + instId + ' ' + (sj.msg || ''));

  // 8. 状态查询
  const st = await j(await fetch(B + `/api/instances/${instId}`, { headers: auth }));
  const inst = st?.data || st;
  ok('实例状态为进行中', ['running', 'completed'].includes(inst?.status), 'status=' + inst?.status);
  ok('业务字段已落库', inst?.biz_system === 'WMS' && inst?.biz_type === 'picking_flow' && inst?.biz_key === bizKey);

  // 9. 审批通过
  const tasks = (await db.query(
    `SELECT id, status, assignee_id FROM flow_task WHERE instance_id=$1 ORDER BY id`, [instId]
  )).rows;
  const pending = tasks.find(t => t.status === 'assigned' || t.status === 'pending');
  ok('生成待办任务', !!pending, '任务数 ' + tasks.length);
  if (pending) {
    // 审批需「任务归属人本人」操作（引擎强校验 assignee_id），
    // 这里直接调用引擎以任务归属人身份审批，验证流转与回调入队。
    const { approveTask } = await import(pathToFileURL(path.join(SERVER, 'src/services/flow-engine.js')).href);
    const r = await approveTask({
      taskId: Number(pending.id), userId: Number(pending.assignee_id),
      action: 'approve', comment: 'E2E 自动审批',
    });
    ok('审批通过', !!r, JSON.stringify(r).slice(0, 120));
  }

  // 10. 审批后状态与回调事件
  const after = (await db.query(`SELECT status FROM flow_instance WHERE id=$1`, [instId])).rows[0];
  ok('审批后实例已完成', after?.status === 'completed', 'status=' + after?.status);
  const ob = (await db.query(
    `SELECT id, event, system_code, status, target_url, payload
       FROM flow_webhook_outbox WHERE instance_id=$1 ORDER BY id`, [instId]
  )).rows;
  ok('回调事件已入队', ob.length > 0, '事件数 ' + ob.length);
  if (ob.length) {
    const last = ob[ob.length - 1];
    ok('事件归属 WMS', last.system_code === 'WMS', String(last.system_code));
    ok('回调地址正确', String(last.target_url).includes('192.168.6.160:3000/api/integration/oa/callback'), last.target_url);
    const p = typeof last.payload === 'string' ? JSON.parse(last.payload) : last.payload;
    ok('回调载荷含业务键', p.bizKey === bizKey && p.bizSystem === 'WMS', JSON.stringify({ bizType: p.bizType, status: p.status }));
  }

  // 11. 清理测试单据
  await db.query(`DELETE FROM flow_webhook_outbox WHERE instance_id=$1`, [instId]);
  for (const t of ['flow_task', 'flow_log', 'flow_execution', 'flow_cc']) {
    await db.query(`DELETE FROM ${t} WHERE instance_id=$1`, [instId]).catch(() => {});
  }
  await db.query(`DELETE FROM flow_instance WHERE id=$1`, [instId]);
  const left = (await db.query(`SELECT count(*)::int n FROM flow_instance WHERE id=$1`, [instId])).rows[0].n;
  ok('测试单据已清理', left === 0);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  console.log('生成的 WMS API Key（请填入 WMS .env 的 OA_API_KEY）:', plainKey);
  await db.end();
  // 关闭引擎内部连接池，避免脚本挂住
  try {
    const dbi = await import(pathToFileURL(path.join(SERVER, 'src/db/index.js')).href);
    await dbi.pool.end();
  } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
