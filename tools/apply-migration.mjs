// 仅执行指定的单个 SQL 迁移（不跑整套 db:init），用于生产增量变更
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const SERVER = 'D:/Program Files/OA/app/server'
const require = createRequire(path.join(SERVER, 'package.json'))
const { Client } = require('pg')

const envTxt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8')
const env = {}
for (const line of envTxt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (!m) continue
  let v = m[2]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

const file = process.argv[2]
if (!file) {
  console.error('用法: node tools/apply-migration.mjs <sql文件路径>')
  process.exit(1)
}
const sql = fs.readFileSync(file, 'utf8')

const client = new Client({
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 5432),
  database: env.DB_NAME || 'oa_system',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD || '',
  ssl: String(env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false,
})

await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('OK applied:', path.basename(file))

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='drive_acl' ORDER BY ordinal_position`
  )
  console.log('drive_acl 列:', cols.rows.map((r) => r.column_name).join(', '))

  const stat = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE can_grant)::int AS grantable
       FROM drive_acl`
  )
  console.log('drive_acl 行数 / 可授权行:', stat.rows[0])
} catch (e) {
  await client.query('ROLLBACK')
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
