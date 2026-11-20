import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SERVER = 'D:/Program Files/OA/app/server';
const req = createRequire(path.join(SERVER, 'package.json'));
const { Client } = req('pg');
const txt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8');
const env = {};
for (const l of txt.split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const B = 'http://127.0.0.1:3999';

(async () => {
  const db = new Client({
    host: env.DB_HOST || 'localhost', port: +(env.DB_PORT || 5432),
    database: env.DB_NAME || 'oa_system', user: env.DB_USER || 'postgres', password: env.DB_PASSWORD || '',
  });
  await db.connect();

  const login = await (await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })).json();
  const auth = { Authorization: 'Bearer ' + login.data.token, 'Content-Type': 'application/json' };

  // 定义 35 的完整信息
  const def = (await db.query(
    `SELECT id, code, name, active, active_version_id, flow_nodes FROM flow_definition WHERE id=35`
  )).rows[0];
  console.log('定义35:', JSON.stringify(def));

  const key = (await db.query(`SELECT id, name FROM sys_api_key ORDER BY id DESC LIMIT 1`)).rows[0];
  console.log('使用密钥:', JSON.stringify(key));

  // 新建一张单据（不清理，便于排查）
  const bizKey = 'DBG-' + Date.now();
  const sub = await (await fetch(B + '/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'oa_7bc6d20d826876a3ad9bb2dc388622a18e5ef937af29f7cd' },
    body: JSON.stringify({
      definitionId: 35, title: 'DBG ' + bizKey, applicantUserId: 1,
      bizSystem: 'WMS', bizType: 'picking_flow', bizKey, submitNow: true, formData: { qty: 1 },
    }),
  })).json();
  console.log('提交结果:', JSON.stringify(sub).slice(0, 400));
  const id = sub.data.id;

  const inst = (await db.query(`SELECT id,status,current_index,biz_system,biz_type,biz_key FROM flow_instance WHERE id=$1`, [id])).rows[0];
  console.log('实例:', JSON.stringify(inst));
  const tasks = (await db.query(`SELECT id,node_index,node_name,node_type,assignee_id,status FROM flow_task WHERE instance_id=$1`, [id])).rows;
  console.log('任务:', JSON.stringify(tasks));
  const execs = (await db.query(`SELECT * FROM flow_execution WHERE instance_id=$1`, [id])).rows;
  console.log('执行记录数:', execs.length, JSON.stringify(execs).slice(0, 300));
  const ob = (await db.query(`SELECT id,event,system_code,status,target_url FROM flow_webhook_outbox WHERE instance_id=$1`, [id])).rows;
  console.log('outbox:', JSON.stringify(ob));
  const sys = (await db.query(`SELECT system_code,base_url,webhook_url,enabled FROM sys_integration_system`)).rows;
  console.log('系统连接:', JSON.stringify(sys));

  await db.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
