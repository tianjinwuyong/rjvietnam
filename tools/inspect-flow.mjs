import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const SERVER = 'D:/Program Files/OA/app/server'
const require = createRequire(path.join(SERVER, 'package.json'))
const { Client } = require('pg')

const txt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8')
const env = {}
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (!m) continue
  let v = m[2]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

const c = new Client({
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 5432),
  database: env.DB_NAME || 'oa_system',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD || '',
})
await c.connect()
try {
  for (const t of ['flow_instance', 'flow_webhook_outbox']) {
    const r = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t])
    console.log(`=== ${t} (${r.rows.length} 列) ===`)
    console.log(r.rows.map(x => x.column_name).join(', '))
  }
  const s = await c.query(`SELECT status, count(*)::int n FROM flow_instance GROUP BY status ORDER BY n DESC`)
  console.log('=== flow_instance 状态分布 ===')
  console.log(s.rows.map(x => `${x.status}=${x.n}`).join(', ') || '(空)')
  const o = await c.query(`SELECT status, count(*)::int n FROM flow_webhook_outbox GROUP BY status`)
  console.log('=== flow_webhook_outbox 状态分布 ===')
  console.log(o.rows.map(x => `${x.status}=${x.n}`).join(', ') || '(空)')
} catch (e) {
  console.log('查询失败:', e.message)
} finally {
  await c.end().catch(() => {})
}
